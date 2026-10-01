import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ConfigChange } from "@autolight/config";
import { CC, NOTE } from "@autolight/controller-flx4";
import { channels } from "@autolight/ipc";
import { AnalysisSupervisor, type AnalysisWorkerPort } from "../../electron/services/analysis-supervisor.js";
import { CloudService } from "../../electron/services/cloud-service.js";
import { ConfigService } from "../../electron/services/config-service.js";
import { IdentityService } from "../../electron/services/identity-service.js";
import { IpcRouter, type IpcEventLike, type IpcMainPort } from "../../electron/services/ipc-router.js";
import { LibraryService, type LibraryChange } from "../../electron/services/library-service.js";
import {
  LifecycleService,
  SHUTDOWN_ORDER,
  STARTUP_ORDER,
  applyCrashPolicy,
} from "../../electron/services/lifecycle.js";
import { MatterBridge, type MatterProcessPort } from "../../electron/services/matter-bridge.js";
import { MidiService } from "../../electron/services/midi-service.js";
import { ProviderManager } from "../../electron/services/provider-manager.js";
import { closeStorageService, getStorageService, openStorageService } from "../../electron/services/storage-service.js";

// T-ARC-05: every main-process service from 04-target-architecture section 1
// is exercised through its real start(), stop() and status() by importing the
// module (no mocks of the modules themselves; only the ports they own are
// substituted, which is the seam production wiring uses too).

const tempDir = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));

describe("config-service", () => {
  it("persists a layered set, emits the change and rejects unknown keys", async () => {
    const dir = tempDir("autolight-config-");
    const file = join(dir, "config.json");
    const svc = new ConfigService({ filePath: file });
    const started = await svc.start();
    expect(started.state).toBe("running");

    const schema = svc.schema();
    const first = schema.keys[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("config registry is empty");

    const before = svc.get(first.key);
    expect(before.ok).toBe(true);
    if (!before.ok) throw new Error("registry key not readable");

    const changes: ConfigChange[] = [];
    svc.onChanged((change) => changes.push(change));
    const written = svc.set("app", first.key, before.value);
    expect(written).toMatchObject({ ok: true, key: first.key, layer: "app" });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.key).toBe(first.key);
    expect(changes[0]?.layer).toBe("app");
    expect(readFileSync(file, "utf8")).toContain(first.key);

    const unknown = svc.get("no.such.key");
    expect(unknown).toMatchObject({ ok: false, error: { code: "E_UNKNOWN_KEY" } });
    expect(svc.stop().state).toBe("stopped");
  });
});

describe("storage-service", () => {
  it("opens the database file it owns, reports the real driver state and closes", () => {
    const dir = tempDir("autolight-storage-");
    const file = join(dir, "autolight.db");
    // T-DATA-01 landed the database owner in this same file (open, status,
    // close); the T-ARC-05 service slice imports it as the storage service.
    const svc = openStorageService({ path: file });
    const status = svc.status();
    expect(status.open).toBe(true);
    expect(status.path).toBe(file);
    expect(["node-sqlite", "better-sqlite3"]).toContain(status.driver);
    expect(status.driverLine).toContain(status.driver);
    expect(svc.statusLine()).toContain(file);
    expect(status.tables).toBeGreaterThan(0);
    expect(status.schemaVersion).toBeGreaterThan(0);

    svc.store.saveVenue("venue-1", "Test Room", '{"cells":[]}');
    expect(svc.store.loadVenue("venue-1")).toBe('{"cells":[]}');
    expect(existsSync(file)).toBe(true);
    expect(getStorageService()).toBe(svc);

    closeStorageService();
    expect(getStorageService()).toBeNull();
  });
});

describe("library-service", () => {
  it("watches a readable root, batches the change and closes the watcher", async () => {
    const root = tempDir("autolight-library-");
    const emitted: ((file: string) => void)[] = [];
    let closed = 0;
    const svc = new LibraryService({
      roots: [{ provider: "serato", path: root }],
      debounceMs: 20,
      watchRoot: (_path, onEvent) => {
        emitted.push(onEvent);
        return { close: () => { closed += 1; }, on: () => undefined };
      },
    });
    const started = svc.start();
    expect(started.state).toBe("running");
    expect(svc.libraryRoots()[0]?.readable).toBe(true);
    expect(svc.status().counters["watchers"]).toBe(1);

    const batches: LibraryChange[][] = [];
    svc.onChanges((changes) => batches.push(changes));
    vi.useFakeTimers();
    try {
      // Two events inside one debounce window: one batch, one timer.
      emitted[0]?.("crate.txt");
      emitted[0]?.("crate.txt");
      expect(batches).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(30);
    } finally {
      vi.useRealTimers();
    }
    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((change) => change.file)).toEqual(["crate.txt", "crate.txt"]);
    expect(batches[0]?.[0]?.provider).toBe("serato");

    expect(svc.stop().counters["watchers"]).toBe(0);
    expect(closed).toBe(1);
  });

  it("degrades when no library root is readable", () => {
    const svc = new LibraryService({ roots: [{ provider: "rekordbox", path: join(tmpdir(), "autolight-missing-root") }] });
    const started = svc.start();
    expect(started.state).toBe("degraded");
    expect(started.detail).toContain("no readable library root");
    svc.stop();
  });
});

describe("identity-service", () => {
  it("resolves through the DS-22 chain and memoizes by native key", () => {
    const svc = new IdentityService();
    expect(svc.start().state).toBe("running");
    const first = svc.resolve({ rekordboxId: "42", title: "Untitled" });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("native id should resolve");
    expect(first.identity.id).toBe("rb:42");
    expect(first.cached).toBe(false);

    const second = svc.resolve({ rekordboxId: "42" });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("cache hit should resolve");
    expect(second.cached).toBe(true);
    expect(svc.status().counters["hits"]).toBe(1);

    const strings = svc.resolve({ title: "A", artist: "B" });
    expect(strings).toMatchObject({ ok: false, error: { code: "E_NO_IDENTITY_KEY" } });
  });
});

describe("analysis-supervisor", () => {
  it("refuses before start, spawns lazily on the first job and stops the worker", async () => {
    const calls = { starts: 0, stops: 0 };
    const worker: AnalysisWorkerPort = {
      start: () => { calls.starts += 1; },
      stop: () => { calls.stops += 1; },
      analyze: async (req) => ({ type: "complete", trackId: req.trackId, artifactPath: `/tmp/${req.trackId}.json` }),
      pendingCount: () => 0,
      queuedCount: () => 0,
    };
    const svc = new AnalysisSupervisor({ createWorker: () => worker });

    const refused = await svc.submit({ trackId: "t1", audioPath: "/tmp/a.wav" });
    expect(refused).toMatchObject({ ok: false, error: { code: "E_SUPERVISOR_NOT_STARTED" } });
    expect(calls.starts).toBe(0);

    expect(svc.start().state).toBe("running");
    const done = await svc.submit({ trackId: "t1", audioPath: "/tmp/a.wav" });
    expect(done).toEqual({ ok: true, artifactPath: "/tmp/t1.json" });
    expect(calls.starts).toBe(1);
    expect(svc.status().counters["jobs"]).toBe(1);
    expect(svc.status().counters["spawned"]).toBe(1);

    expect(svc.stop().state).toBe("stopped");
    expect(calls.stops).toBe(1);
  });
});

describe("provider-manager", () => {
  it("runs the AX poll loop and the ProLink observer, then stops both", async () => {
    const captured: { beat: ((beat: number, bpm: number | null) => void) | null } = { beat: null };
    const svc = new ProviderManager({
      pollMs: 5,
      readDecks: async () => [
        { deckId: 1, elapsedSeconds: 12.5, playing: true, readable: true },
        { deckId: 2, elapsedSeconds: null, playing: null, readable: false },
      ],
      watchProlink: (onBeat) => {
        captured.beat = onBeat;
        return () => { captured.beat = null; };
      },
    });

    expect(svc.start().state).toBe("running");
    vi.useFakeTimers();
    try {
      // Deterministic clock: the poll loop is driven by setInterval.
      await vi.advanceTimersByTimeAsync(20);
    } finally {
      vi.useRealTimers();
    }
    expect(svc.status().counters["axTicks"]).toBeGreaterThan(0);
    expect(svc.status().counters["readableDecks"]).toBe(1);
    expect(svc.latest().ax[0]?.deckId).toBe(1);
    expect(svc.providers().find((p) => p.id === "rekordbox-ax")?.detail).toBe("readable");

    captured.beat?.(4, 128);
    expect(svc.latest().prolink).toMatchObject({ peerPresent: true, beat: 4, bpm: 128 });

    const stopped = svc.stop();
    expect(stopped.counters["axRunning"]).toBe(0);
    expect(stopped.counters["prolinkRunning"]).toBe(0);
    expect(captured.beat).toBeNull();
  });
});

describe("midi-service", () => {
  it("degrades without a backend but still classifies CC and note hints", () => {
    const svc = new MidiService();
    const started = svc.start();
    expect(started.state).toBe("degraded");
    expect(started.detail).toContain("MIDI backend");

    expect(svc.handleCc(CC.CHANNEL_FADER_1, 127)).toEqual({ kind: "fader-rise", channel: 1, value: 1 });
    expect(svc.handleCc(CC.CROSSFADER, 64)).toBeNull();
    expect(svc.handleNote(NOTE.PLAY_1, 0)).toEqual({ kind: "transport", control: "PLAY_1", on: false });
    expect(svc.status().counters["hints"]).toBe(2);
  });

  it("opens an injected backend and publishes its messages as hints", () => {
    const backend: { send: ((msg: { cc?: number; note?: number; value: number }) => void) | null; closed: boolean } = { send: null, closed: false };
    const svc = new MidiService({
      openBackend: () => ({
        name: "fake-flx4",
        open: (onMessage) => { backend.send = onMessage; },
        close: () => { backend.closed = true; },
      }),
    });
    expect(svc.start().state).toBe("running");
    backend.send?.({ cc: CC.FILTER_2, value: 64 });
    expect(svc.latestHints().at(-1)?.kind).toBe("filter-sweep");
    expect(svc.stop().state).toBe("stopped");
    expect(backend.closed).toBe(true);
  });
});

describe("matter-bridge", () => {
  it("degrades without a controller process and restarts an injected one on exit", () => {
    const unwired = new MatterBridge();
    const degraded = unwired.start();
    expect(degraded.state).toBe("degraded");
    expect(degraded.detail).toContain("not wired");

    const exits: ((code: number | null) => void)[] = [];
    const sent: unknown[] = [];
    const port: MatterProcessPort = {
      name: "matter-test",
      postMessage: (msg) => { sent.push(msg); },
      onMessage: (listener) => { listener({ ready: true }); },
      onExit: (listener) => { exits.push(listener); },
      kill: () => undefined,
    };
    const svc = new MatterBridge({ spawn: () => port });
    expect(svc.start().state).toBe("running");
    expect(svc.send({ op: "ping" })).toBe(true);
    expect(sent).toEqual([{ op: "ping" }]);
    expect(svc.recentMessages()).toEqual([{ ready: true }]);
    expect(svc.status().counters["restarts"]).toBe(0);

    exits[0]?.(1);
    expect(svc.status().counters["restarts"]).toBe(1);
    expect(svc.status().state).toBe("running");
    expect(svc.stop().state).toBe("stopped");
  });
});

describe("cloud-service", () => {
  it("is off by default and refuses metadata without a transport or key", async () => {
    const svc = new CloudService();
    const started = svc.start();
    expect(started.state).toBe("degraded");
    expect(await svc.devices()).toMatchObject({ ok: false, error: { code: "E_CLOUD_DISABLED" } });

    const keyless = new CloudService({ enabled: true, transport: { name: "fake-cloud", devices: async () => [] } });
    expect(keyless.start().state).toBe("degraded");
    expect(await keyless.devices()).toMatchObject({ ok: false, error: { code: "E_CLOUD_NO_KEY" } });
  });

  it("fetches metadata only, never frames", async () => {
    const svc = new CloudService({
      enabled: true,
      apiKey: "key",
      transport: {
        name: "fake-cloud",
        devices: async () => [{ device: "AA:BB:CC", sku: "H6076", name: "Strip" }],
      },
    });
    expect(svc.start().state).toBe("running");
    const res = await svc.devices();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("enabled cloud service should fetch");
    expect(res.devices[0]?.sku).toBe("H6076");
    expect(svc.deviceMetadata()).toHaveLength(1);
    // Frames are owned by the show host; this service has no frame surface.
    expect("pushFrame" in svc).toBe(false);
    expect("setBrightness" in svc).toBe(false);
  });
});

describe("lifecycle", () => {
  it("runs the startup stage machine with timing and honest degraded reasons", () => {
    const svc = new LifecycleService({ userDataDir: "/tmp/autolight-user" });
    expect(svc.start().state).toBe("running");
    expect(svc.status().counters["stages"]).toBe(STARTUP_ORDER.length);
    expect(svc.nextStage()).toBe("db");
    expect(svc.ready()).toBe(false);

    svc.advance("db", "running");
    const ok = svc.advance("db", "ok");
    expect(typeof ok.ms).toBe("number");
    expect(svc.nextStage()).toBe("show-worker");

    svc.advance("show-worker", "degraded", "rekordbox closed");
    for (const stage of STARTUP_ORDER.slice(2)) svc.advance(stage, "ok");
    expect(svc.ready()).toBe(true);
    expect(svc.degradedReasons()).toEqual(["show-worker: rekordbox closed"]);
    expect(svc.status().counters["ready"]).toBe(1);
    expect(svc.crashPath()).toBe("/tmp/autolight-user/crash-last.json");
    expect(() => svc.advance("no-such-stage" as never, "ok")).toThrow(/unknown startup stage/);
  });

  it("keeps running shutdown past a wedged step and stops accepting UI", async () => {
    const svc = new LifecycleService();
    const wedged = Promise.withResolvers<void>();
    const seen: string[] = [];
    const logs = await svc.shutdown({
      timeoutMs: 20,
      ports: { workers: () => wedged.promise },
      onStep: (step) => { seen.push(step); },
    });
    expect(logs).toHaveLength(SHUTDOWN_ORDER.length);
    expect(logs.find((log) => log.step === "workers")?.timedOut).toBe(true);
    expect(logs.some((log) => log.step === "exit")).toBe(true);
    expect(seen).toEqual([...SHUTDOWN_ORDER]);
    expect(svc.isAcceptingUi()).toBe(false);
  });

  it("runs the crash policy in order: record, hold, restart, dim", async () => {
    const calls: string[] = [];
    const policy = applyCrashPolicy({
      holdMs: 10,
      crashRecordPath: "/tmp/crash.json",
      error: new Error("boom"),
      safeLook: (kind) => { calls.push(`look:${kind}`); },
      restartShowHost: () => { calls.push("restart"); },
      writeRecord: (path, json) => { calls.push(`record:${path}:${json.includes("boom")}`); },
    });
    await policy.dimmed;
    expect(calls).toEqual(["record:/tmp/crash.json:true", "look:hold", "restart", "look:dim"]);
    expect(policy.restarted).toBe(true);
  });
});

describe("ipc-router", () => {
  it("registers every typed channel, validates both directions and checks the sender", async () => {
    const registered = new Map<string, (event: IpcEventLike, payload: unknown) => Promise<unknown>>();
    const port: IpcMainPort = {
      handle: (channel, listener) => { registered.set(channel, listener); },
      removeHandler: (channel) => { registered.delete(channel); },
    };
    const listener = (name: string): ((event: IpcEventLike, payload: unknown) => Promise<unknown>) => {
      const found = registered.get(name);
      if (!found) throw new Error(`channel ${name} not registered`);
      return found;
    };

    const router = new IpcRouter(port);
    expect(router.start().state).toBe("running");
    expect(registered.size).toBe(Object.keys(channels).length);
    expect(router.status().counters["registered"]).toBe(1);

    const app = { senderFrame: { url: "file:///index.html" } };
    expect(await listener("master/freeze")(app, { version: 1, frozen: true })).toEqual({ ok: true, frozen: true });

    const denied = await listener("master/freeze")({ senderFrame: { url: "https://evil.example/" } }, { version: 1, frozen: true });
    expect(denied).toMatchObject({ ok: false, error: { code: "E_SENDER" } });

    const invalid = await listener("master/freeze")(app, { version: 999, frozen: "yes" });
    expect(invalid).toMatchObject({ ok: false, error: { code: "E_HANDLER" } });

    // Config channels land on config-service, the single config owner.
    const schema = await listener("config/schema")(app, { version: 1 });
    expect(schema).toMatchObject({ ok: true });
    if (typeof schema !== "object" || schema === null || !("keys" in schema)) throw new Error("schema reply missing keys");
    expect(Array.isArray(schema.keys) && schema.keys.length > 0).toBe(true);
    expect(await listener("config/get")(app, { version: 1, key: "no.such.key" }))
      .toMatchObject({ ok: false, error: { code: "E_UNKNOWN_KEY" } });

    expect(router.stop().counters["registered"]).toBe(0);
    expect(registered.size).toBe(0);
  });
});

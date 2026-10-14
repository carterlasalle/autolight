import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ConfigChange } from "@autolight/config";
import { CC, NOTE } from "@autolight/controller-flx4/consts";
import { channels } from "@autolight/ipc";
import { AnalysisSupervisor, type AnalysisWorkerPort } from "../../electron/services/analysis-supervisor.js";
import { CloudService } from "../../electron/services/cloud-service.js";
import { ConfigService, getConfigService, resetConfigServiceForTest } from "../../electron/services/config-service.js";
import { IdentityService } from "../../electron/services/identity-service.js";
import { IpcRouter, type IpcMainPort, type IpcPortListener, type RawIpcValue } from "../../electron/services/ipc-router.js";
import { LibraryService, type LibraryChange } from "../../electron/services/library-service.js";
import {
  LifecycleService,
  SHUTDOWN_ORDER,
  STARTUP_ORDER,
  applyCrashPolicy,
} from "../../electron/services/lifecycle.js";
import { MatterBridge, type MatterProcessPort } from "../../electron/services/matter-bridge.js";
import { MidiService } from "../../electron/services/midi-service.js";
import { ProviderManager, getProviderManager, resetProviderManagerForTest } from "../../electron/services/provider-manager.js";
import { getLiveShowBridge, resetLiveShowBridgeForTest } from "../../electron/services/live-show-bridge.js";
import { GoveeLanManager, resetGoveeManager } from "../../electron/govee-lan.js";
import { getShowService } from "../../electron/show-service.js";
import * as showService from "../../electron/show-service.js";
import type { ShowServiceState } from "../../electron/show-service.js";
import { GoveeLanSim } from "../../../../packages/simulator/src/govee-lan.js";
import { closeStorageService, getStorageService, openStorageService } from "../../electron/services/storage-service.js";

// T-ARC-05: every main-process service from 04-target-architecture section 1
// is exercised through its real start(), stop() and status() by importing the
// module (no mocks of the modules themselves; only the ports they own are
// substituted, which is the seam production wiring uses too).

const tempDir = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));

// Committed TrackModel fixture (the T-ANA-12 parity file): T-TRU-03's live
// proof is self-contained, so CI and any dev machine run the same test.
const FIXTURE_TRACK_MODEL = fileURLToPath(new URL("../../../../test-fixtures/analysis/live-deck1.trackmodel.json", import.meta.url));

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
  it("adopts an injected store: writes through either side read through the other (AL-STATE-002)", async () => {
    const { PersistentConfigStore } = await import("@autolight/config");
    const dir = tempDir("autolight-config-shared-");
    const shared = new PersistentConfigStore(join(dir, "config.json"));
    const svc = new ConfigService({ store: shared });
    expect((await svc.start()).state).toBe("running");
    // Write via the service, read via the raw store: one mirror, no copy.
    const first = svc.schema().keys[0];

    if (!first) throw new Error("config registry is empty");
    expect(svc.set("app", first.key, 0.5)).toMatchObject({ ok: true });
    expect(shared.get(first.key)).toBe(0.5);
    // Write via the raw store (show-service hot path), read via the service.
    shared.set("app", first.key, 0.7);
    expect(svc.get(first.key)).toMatchObject({ ok: true, value: 0.7 });
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
  it("re-resolves when a stronger identifier set arrives and skips blanks", () => {
    const svc = new IdentityService();
    svc.start();
    const pathOnly = svc.resolve({ canonicalPath: "/a/b" });
    expect(pathOnly.ok).toBe(true);

    if (!pathOnly.ok) throw new Error("path should resolve");
    expect(pathOnly.identity.id).toBe("path:/a/b");
    // Same path plus a file hash must re-resolve (never serve the stale
    // path-only entry); the canonical id keeps the §12 priority where the
    // path outranks the content hash.
    const hashed = svc.resolve({ canonicalPath: "/a/b", fileHash: "H" });
    expect(hashed.ok).toBe(true);

    if (!hashed.ok) throw new Error("hash should resolve");
    expect(hashed.identity.id).toBe("path:/a/b");
    expect(hashed.identity.sourceIds).toEqual({});
    expect(hashed.cached).toBe(false);
    // A blank native id fails over to the valid path instead of erroring.
    const blank = svc.resolve({ rekordboxId: "  ", canonicalPath: "/a/b" });
    expect(blank.ok).toBe(true);
  });
  it("returns copies so callers cannot corrupt the cache", () => {
    const svc = new IdentityService();
    svc.start();
    const first = svc.resolve({ rekordboxId: "99" });
    expect(first.ok).toBe(true);

    if (!first.ok) throw new Error("native id should resolve");
    first.identity.sourceIds.rekordboxId = "MUTATED";
    const second = svc.resolve({ rekordboxId: "99" });
    expect(second.ok).toBe(true);

    if (!second.ok) throw new Error("cache hit should resolve");
    expect(second.identity.sourceIds.rekordboxId).toBe("99");
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

describe("show-host-supervisor", () => {
  it("spawns the worker lazily and reports jitter metrics (§131)", async () => {
    const { ShowHostSupervisor } = await import("../../electron/services/show-host-supervisor.js");
    const posted: unknown[] = [];
    const listeners: ((message: unknown) => void)[] = [];
    let terminated = 0;

    const svc = new ShowHostSupervisor({
      workerEntryUrl: "test-entry",
      createWorker: () => ({
        postMessage: (message: unknown) => { posted.push(message); },
        onMessage: (listener: (message: unknown) => void) => { listeners.push(listener); },
        terminate: () => { terminated += 1; },
      }),
    });

    expect(svc.start().state).toBe("running");
    expect(posted).toHaveLength(0);
    // start() wires the master-intent forwarder to the worker: firing a
    // master channel through show-service posts one typed intent message.
    showService.setMasterBlackout();
    expect(posted).toEqual([{ type: "intent", channel: "master/blackout", request: { version: 1 } }]);
    showService.resumeMaster("bar");
    expect(posted).toHaveLength(2);
    showService.resetHostIntentForwarderForTest();
    expect(svc.status().counters["spawned"]).toBe(1);

    // Jitter metrics arrive over the port and surface in status.
    for (const listener of listeners) {
      listener({ type: "metrics", metrics: {
        ticks: 600, snapshotsPublished: 300, supersededFrames: 0,
        intervalP50Ms: 16.7, intervalP99Ms: 17.9, intervalMaxMs: 22.1,
        missedTicksPerHour: 0,
      } });
    }

    expect(svc.metrics()?.intervalP99Ms).toBeCloseTo(17.9, 9);
    expect(svc.status().counters["intervalP99Ms"]).toBeCloseTo(17.9, 9);
    expect(svc.stop().state).toBe("stopped");
    expect(terminated).toBe(1);
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
  it("reports composite idle when the board is absent, connected with the hook", async () => {
    const idle = new ProviderManager({
      pollMs: 5,
      readDecks: async () => [],
      watchProlink: () => () => undefined,
    });

    idle.start();
    expect(idle.providers().find((p) => p.id === "composite-flx4")).toMatchObject({
      running: false,
      detail: "FLX4 not present, composite idle",
    });
    idle.stop();

    let stopped = false;

    const svc = new ProviderManager({
      pollMs: 5,
      readDecks: async () => [],
      watchProlink: () => () => undefined,
      bootComposite: async () => ({ connected: true, portName: "DDJ-FLX4 MIDI 1", detail: "connected on DDJ-FLX4 MIDI 1" }),
      stopComposite: async () => {
        stopped = true;
      },
    });

    svc.start();
    await vi.waitFor(() => {
      expect(svc.providers().find((p) => p.id === "composite-flx4")?.running).toBe(true);
    });
    expect(svc.providers().find((p) => p.id === "composite-flx4")?.detail).toContain("DDJ-FLX4 MIDI 1");
    svc.stop();
    expect(stopped).toBe(true);
    expect(svc.providers().find((p) => p.id === "composite-flx4")?.running).toBe(false);
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

  it("never respawns after stop, ignores stale exits, and isolates faulty listeners", () => {
    const exits: ((code: number | null) => void)[] = [];
    let spawned = 0;

    const port: MatterProcessPort = {
      name: "matter-lifecycle",
      postMessage: () => {
        throw new Error("crashed between exit and handler");
      },
      onMessage: (listener) => { listener({ ready: true }); },
      onExit: (listener) => { exits.push(listener); },
      kill: () => {
        // Intentional shutdown must not respawn via the async exit handler.
        for (const exit of exits.splice(0)) exit(0);
      },
    };

    const svc = new MatterBridge({ spawn: () => { spawned += 1;

 return port; } });
    const seen: unknown[] = [];

    svc.onMessage(() => seen.push("ok"));
    svc.onMessage(() => { throw new Error("faulty subscriber"); });
    svc.onMessage(() => seen.push("also ok"));
    expect(svc.start().state).toBe("running");
    expect(seen).toEqual(["ok", "also ok"]);
    // Dead port between exit and handler: boolean contract, no throw.
    expect(svc.send({ op: "ping" })).toBe(false);
    expect(svc.stop().state).toBe("stopped");
    expect(spawned).toBe(1);

    // Stale exit after stop: no respawn, no orphan.
    for (const exit of exits.splice(0)) exit(1);
    expect(spawned).toBe(1);
    expect(svc.status().state).toBe("stopped");
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
    const registered = new Map<string, IpcPortListener>();

    const port: IpcMainPort = {
      handle: (channel, listener) => { registered.set(channel, listener); },
      removeHandler: (channel) => { registered.delete(channel); },
    };

    const listener = (name: string): IpcPortListener => {
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
    // Request validation runs before any handler: an invalid payload is a
    // rejected REQUEST (E_REQUEST), never a handler failure.
    expect(invalid).toMatchObject({ ok: false, error: { code: "E_REQUEST" } });

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

// T-TRU-03 harness: every channel-group test gets a fresh router +
// file-backed config + stubbed providers, so a failure in one group cannot
// skip coverage in another (the old single-it() shape aborted everything
// after the first red row, silently dropping the recorder guard).
interface Tru03 {
  call: (name: string, payload: RawIpcValue) => Promise<Record<string, unknown>>;
  svc: ShowServiceState;
}

async function setupTru03(): Promise<Tru03 & { cleanup: () => void }> {
  const dir = tempDir("autolight-tru03-");
  resetConfigServiceForTest();
  resetProviderManagerForTest();
  await getConfigService({ filePath: join(dir, "config.json") });
  // follow/ax reads the provider manager with stubbed readers: deck 1
  // readable, deck 2 denied. Production wires osascript plus :50001 here.
  getProviderManager({
    readDecks: async () => [
      { deckId: 1, elapsedSeconds: 12.5, playing: true, readable: true },
      { deckId: 2, elapsedSeconds: null, playing: null, readable: false },
    ],
    watchProlink: () => () => undefined,
  });
  const registered = new Map<string, IpcPortListener>();

  const port: IpcMainPort = {
    handle: (channel, listener) => { registered.set(channel, listener); },
    removeHandler: (channel) => { registered.delete(channel); },
  };

  const router = new IpcRouter(port);
  router.start();
  // Every typed channel is exercised: the count guards against a new
  // channel landing without a side-effect row below.
  expect(registered.size).toBe(Object.keys(channels).length);
  const app = { senderFrame: { url: "file:///index.html" } };

  const call = async (name: string, payload: RawIpcValue): Promise<Record<string, unknown>> => {
    const found = registered.get(name);

    if (!found) throw new Error(`channel ${name} not registered`);
    // SAFETY: the router's reply shapes vary per channel; the row below
    // asserts `ok: true`, so the cast cannot mask an error reply.
    const res = (await found(app, payload)) as Record<string, unknown>;
    expect(res).toMatchObject({ ok: true });

    return res;
  };

  return {
    call,
    svc: getShowService(),
    cleanup: () => {
      showService.resetHostIntentForwarderForTest();
      resetLiveShowBridgeForTest();
      resetConfigServiceForTest();
      resetProviderManagerForTest();
      router.stop();
    },
  };
}

// AL-FLOW-001 fixture share + committed TrackModel (mirrors
// live-show-bridge.test.ts): no machine paths, so CI and any dev machine
// run the same proof.
async function withLiveBridge(): Promise<void> {
  resetLiveShowBridgeForTest();
  const fixtureShare = mkdtempSync(join(tmpdir(), "tru03-share-"));
  const bucket = join(fixtureShare, "135");
  const trackDir = join(bucket, "fb47d-24bc-49c5-b5e7-ce275ed46465");
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, "ANLZ0000.DAT"), "", "utf16le");
  const artifactDir = mkdtempSync(join(tmpdir(), "tru03-artifact-"));
  const artifactPath = join(artifactDir, "live-deck1.trackmodel.json");
  copyFileSync(FIXTURE_TRACK_MODEL, artifactPath);
  getLiveShowBridge({ shareDir: fixtureShare, analyze: async () => artifactPath });
}

// show-service's govee() entry rebuilds the singleton from optionsFromConfig:
// reset first, then rebuild through that entry so venue/* handlers and the
// test share one manager. The sim's ports are construction-time, so they
// ride in through the app config the entry already reads.
async function withSimGovee(svc: ShowServiceState, simPort: number): Promise<void> {
  const cfg = await getConfigService();
  cfg.set("app", "govee.lan.ports.scan", simPort);
  cfg.set("app", "govee.lan.ports.reply", 0);
  cfg.set("app", "govee.lan.ports.control", simPort);
  cfg.set("app", "govee.lan.discovery.multicast", false);
  cfg.set("app", "govee.lan.discovery.perInterfaceBroadcast", false);
  cfg.set("app", "govee.lan.discovery.globalBroadcast", false);
  // show-service owns a SEPARATE PersistentConfigStore (T-CFG-02), not
  // the ConfigService: mirror the sim ports there so govee() builds the
  // same manager the probe below verified. scanList rides in through
  // the same store because optionsFromConfig reads strings() there
  // (applyLiveTunables only re-seeds an already-set list).
  svc.config.set("app", "govee.lan.ports.scan", simPort);
  svc.config.set("app", "govee.lan.ports.reply", 0);
  svc.config.set("app", "govee.lan.ports.control", simPort);
  svc.config.set("app", "govee.lan.discovery.multicast", false);
  svc.config.set("app", "govee.lan.discovery.perInterfaceBroadcast", false);
  svc.config.set("app", "govee.lan.discovery.globalBroadcast", false);
  svc.config.set("app", "govee.lan.discovery.scanList", ["127.0.0.1"]);
  showService.govee();
}

// T-TRU-03: no channel echoes its payload. Every channel runs through the
// same dispatch path as production (router with a recording port) and each
// row asserts a channel-specific observable effect or an authoritative read
// from show-service state, the config file, or the Govee registry snapshot.
// An echo regression (returning the request payload without touching state)
// turns its row red because the state read would not have moved.
describe("ipc handlers have real effects (T-TRU-03)", () => {
  it("master channels mutate overrides and forward one intent each", async () => {
    const { call, svc, cleanup } = await setupTru03();

    try {
      // Master override channels mutate the override state (T-RUN-07) and
      // forward one intent each to the attached show host (issue #5 gap #6:
      // single override path, no parallel state).
      const forwarded: { channel: string; request: unknown }[] = [];
      showService.setHostIntentForwarder((channel, request) => { forwarded.push({ channel, request }); });
      await call("master/blackout", { version: 1 });
      expect(svc.overrides.blackout).toBe(true);
      expect(forwarded).toEqual([{ channel: "master/blackout", request: { version: 1 } }]);
      await call("master/full", { version: 1 });
      expect(svc.overrides.full).toBe(true);
      expect(svc.overrides.blackout).toBe(false);
      await call("master/freeze", { version: 1, frozen: true });
      expect(svc.overrides.frozen).toBe(true);
      await call("master/freeze", { version: 1, frozen: false });
      expect(svc.overrides.frozen).toBe(false);
      await call("master/intensity", { version: 1, value: 0.5 });
      expect(svc.overrides.intensity).toBeCloseTo(0.5, 9);
      await call("master/resume", { version: 1, at: "bar" });
      expect(svc.overrides).toMatchObject({ blackout: false, full: false, frozen: false });
      expect(forwarded.map((f) => f.channel)).toEqual([
        "master/blackout", "master/full", "master/freeze", "master/freeze",
        "master/intensity", "master/resume",
      ]);
    } finally {
      cleanup();
    }
  });

  it("show channels mutate director state and record the trigger", async () => {
    const { call, svc, cleanup } = await setupTru03();

    try {
      const seenEvents = svc.recorder.count();
      await call("show/style", { version: 1, style: "Techno", palette: "Cold" });
      expect(svc.showStyle).toEqual({ style: "Techno", palette: "Cold" });
      await call("show/energy", { version: 1, tier: "HIGH" });
      expect(svc.energyTier).toBe("HIGH");
      await call("show/trigger-build", { version: 1 });
      await call("show/trigger-drop", { version: 1 });
      const state = await call("show/state", { version: 1, deck: 2 });
      expect(state).toMatchObject({ ok: true, deck: 2 });
      expect(svc.recorder.count()).toBeGreaterThan(seenEvents);
    } finally {
      cleanup();
    }
  });

  it("show/live serves the stubbed readable deck end to end (AL-FLOW-001)", async () => {
    const { call, cleanup } = await setupTru03();

    try {
      // AL-FLOW-001: poll -> bridge resolve -> populated deck, never constant
      // empty.
      await withLiveBridge();
      const live = await call("show/live", { version: 1 });
      // SAFETY: show/live's reply contract carries a decks array; the length
      // and beat-grid assertions below fail loudly if the shape ever changes.
      const decks = live["decks"] as { state: { playheadSeconds: number }; track: { beatGrid: { beats: unknown[] } } | null; plan: unknown }[];
      expect(decks[0]?.track?.beatGrid.beats.length).toBeGreaterThan(100);
      expect(decks[0]?.plan).not.toBeNull();
      expect(decks[0]?.state.playheadSeconds).toBe(12.5);
    } finally {
      cleanup();
    }
  });

  it("follow, venue color and simulator mode mutate service state", async () => {
    const { call, svc, cleanup } = await setupTru03();

    try {
      await call("follow/mode", { version: 1, mode: "ax" });
      expect(svc.followMode).toBe("ax");
      // follow/ax returns the stubbed provider readings (deck 1 readable).
      const ax = await call("follow/ax", { version: 1 });
      // SAFETY: follow/ax's reply contract carries a readings array; the
      // per-deck assertions below fail loudly if the shape ever changes.
      const readings = ax["readings"] as { deckId: number; readable: boolean }[];
      expect(readings.find((r) => r.deckId === 1)?.readable).toBe(true);
      expect(readings.find((r) => r.deckId === 2)?.readable).toBe(false);
      await call("venue/set-color", { version: 1, rgb: [10, 20, 30] });
      expect(svc.venueColor).toEqual([10, 20, 30]);
      // device-action dispatches through the Govee manager to the scanned sim
      // in the venue test below; the registry starts empty here.
      expect(svc.deviceIps.size).toBe(0);
      await call("simulator/mode", { version: 1, enabled: true });
      expect(svc.simulatorMode).toBe(true);
      await call("simulator/mode", { version: 1, enabled: false });
      expect(svc.simulatorMode).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("venue channels discover and drive a loopback sim (T-GOV-05 ladder)", { timeout: 20_000 }, async () => {
    const { call, svc, cleanup } = await setupTru03();

    // Scan-list-only discovery against a loopback sim: no LAN touched, the
    // discovered MAC is the observable effect (T-GOV-05 scan ladder).
    // venue/list is asserted after the scan, against the non-empty registry.
    // Static imports: the sim source is a workspace file, always present.
    const sim = new GoveeLanSim({ device: "AA:BB:CC:DD:EE:01", sku: "H6076", zones: 14 });
    const simPort = await sim.start(0);

    const lan = new GoveeLanManager({
      replyPort: 0,
      scanPort: simPort,
      controlPort: simPort,
      multicast: false,
      perInterfaceBroadcast: false,
      globalBroadcast: false,
      scanList: ["127.0.0.1"],
      backgroundRescanMs: 60000,
      statusDeadlineMs: 300,
      statusRetryMs: 50,
    });

    try {
      const found = await lan.scanOnce(400);
      expect(found.map((d) => d.mac)).toContain("AA:BB:CC:DD:EE:01");

      // The probe manager owns a bound reply socket: always release it in a
      // dedicated finally, even if the singleton rebuild below throws.
      try {
        // venue/scan, identify, test-chase and device-action run against the
        // app's own manager rebuilt with the sim's ports: scan-list-only
        // discovery, no LAN touched (T-GOV-05 ladder over the wire, T-GOV-12
        // actions). Ports are construction-time (a started manager's reply
        // socket is already bound), so the app singleton is reset and rebuilt
        // through show-service's own govee() entry point. Earlier rows already
        // built the app singleton (venue/list binds the default reply port):
        // stop and reset it BEFORE releasing the probe lan, otherwise the
        // probe's stop closes nothing and the stale singleton keeps the port.
        showService.govee().stop();
        resetGoveeManager();
        await withSimGovee(svc, simPort);
        const appMgr = showService.govee();

        try {
          const scanned = await call("venue/scan", { version: 1 });
          // SAFETY: venue/scan and venue/list reply with devices/fixtures
          // arrays; the length assertions below fail loudly on shape change.
          expect((scanned["devices"] as unknown[]).length).toBeGreaterThan(0);
          // SAFETY: device records carry name/enabled/firmware; the tile
          // rows below read exactly these fields.
          const devices = scanned["devices"] as { name: string; enabled: boolean; firmware: string }[];
          expect(devices[0]?.name).toBe("AA:BB:CC:DD:EE:01");
          expect(devices[0]?.enabled).toBe(true);
          expect(devices[0]?.firmware).toBe("1.02.03");
          // venue/list reads the same registry snapshot (non-empty now).
          const venue = await call("venue/list", { version: 1 });
          expect((venue["fixtures"] as unknown[]).length).toBeGreaterThan(0);

          // Manual lane end to end (T-RUN-07, spec 50): the IPC handler
          // drives the manager, the manager drives UDP, the sim is the
          // witness. Runs before identify/test-chase so no flash-restore
          // timer can race the assertions.
          const displayed = (): [number, number, number] =>
            sim.armedState ? (sim.rendered[0] ?? [0, 0, 0]) : sim.lightState.color;

          await call("venue/set-color", { version: 1, rgb: [10, 20, 30] });
          await vi.waitFor(() => { expect(displayed()).toEqual([10, 20, 30]); });
          await call("master/blackout", { version: 1 });
          await vi.waitFor(() => { expect(displayed()).toEqual([0, 0, 0]); });
          await call("master/resume", { version: 1, at: "bar" });
          await vi.waitFor(() => { expect(displayed()).toEqual([10, 20, 30]); });

          // Rename persists in the registry snapshot (the venue tile label).
          const renamed = await call("venue/device-rename", { version: 1, id: "AA:BB:CC:DD:EE:01", name: "Back left" });
          expect(renamed).toMatchObject({ ok: true, name: "Back left" });
          expect(appMgr.registrySnapshot().find((d) => d.mac === "AA:BB:CC:DD:EE:01")?.name).toBe("Back left");

          // A disabled fixture is skipped by the manual all-commands:
          // the receipt names nothing and the wire stays quiet.
          await call("venue/device-enabled", { version: 1, id: "AA:BB:CC:DD:EE:01", enabled: false });
          expect(appMgr.registrySnapshot().find((d) => d.mac === "AA:BB:CC:DD:EE:01")?.enabled).toBe(false);
          expect(await appMgr.setColorAll(1, 2, 3)).toEqual({ ok: [], failed: [] });
          expect(displayed()).toEqual([10, 20, 30]);
          await call("venue/device-enabled", { version: 1, id: "AA:BB:CC:DD:EE:01", enabled: true });
          expect((await appMgr.setColorAll(4, 5, 6)).ok).toEqual(["AA:BB:CC:DD:EE:01"]);
          await vi.waitFor(() => { expect(displayed()).toEqual([4, 5, 6]); });

          // Segment console over the wire: stripes arm the stream at the
          // candidate count, the saved count lands in the registry, and the
          // range paint addresses exactly the picked slice.
          await call("venue/paint-stripes", { version: 1, id: "AA:BB:CC:DD:EE:01", zones: 8 });
          await vi.waitFor(() => { expect(sim.armedState).toBe(true); });
          await vi.waitFor(() => {
            expect(sim.rendered.slice(0, 8).map((c) => c.join(","))).toEqual([
              "255,0,0", "0,0,255", "255,0,0", "0,0,255", "255,0,0", "0,0,255", "255,0,0", "0,0,255",
            ]);
          });
          // A probe count is not a confirmed count: the snapshot (and the
          // tile's "segments counted") stays null until the operator saves.
          expect(appMgr.registrySnapshot().find((d) => d.mac === "AA:BB:CC:DD:EE:01")?.zones).toBeNull();
          await call("venue/segments-set", { version: 1, id: "AA:BB:CC:DD:EE:01", zones: 8 });
          expect(appMgr.registrySnapshot().find((d) => d.mac === "AA:BB:CC:DD:EE:01")?.zones).toBe(8);
          await call("venue/paint-range", { version: 1, id: "AA:BB:CC:DD:EE:01", from: 0, to: 3, rgb: [0, 255, 0] });
          await vi.waitFor(() => {
            expect(sim.rendered.slice(0, 8).map((c) => c.join(","))).toEqual([
              "0,255,0", "0,255,0", "0,255,0", "0,255,0", "0,0,0", "0,0,0", "0,0,0", "0,0,0",
            ]);
          });

          await call("venue/identify", { version: 1, id: "AA:BB:CC:DD:EE:01" });
          await call("venue/test-chase", { version: 1, id: "AA:BB:CC:DD:EE:01" });
          const acted = await call("venue/device-action", { version: 1, id: "AA:BB:CC:DD:EE:01", action: "identify" });
          expect(acted).toMatchObject({ ok: true, id: "AA:BB:CC:DD:EE:01", action: "identify" });
          expect(svc.deviceIps.get("AA:BB:CC:DD:EE:01")).toBe("127.0.0.1");
        } finally {
          appMgr.stop();
          resetGoveeManager();
        }
      } finally {
        lan.stop();
      }
    } finally {
      await sim.stop();
      cleanup();
    }
  });

  it("audio and diagnostics channels read the renderer tables", async () => {
    const { call, cleanup } = await setupTru03();

    try {
      // Audio surface: renderer owns enumeration, main reports none.
      const devices = await call("audio/devices", { version: 1 });
      expect(devices).toEqual({ ok: true, devices: [] });
      const level = await call("audio/level", { version: 1 });
      expect(level).toEqual({ ok: true, level: 0 });
      // Diagnostics tab names come from the renderer tab table (spec 101).
      const diag = await call("diagnostics/get", { version: 1, tab: "Transport" });
      expect(diag).toMatchObject({ ok: true, tab: "Transport" });
      const all = await call("diagnostics/all", { version: 1 });
      expect(typeof all["diagnostics"]).toBe("object");
    } finally {
      cleanup();
    }
  });

  it("config channels round-trip through the file-owning service", async () => {
    const { call, svc, cleanup } = await setupTru03();

    try {
      const seenEvents = svc.recorder.count();
      await call("show/trigger-build", { version: 1 });
      const schema = await call("config/schema", { version: 1 });
      // SAFETY: config/schema's reply contract carries a keys array; the
      // assertion below fails loudly if the shape ever changes.
      expect(Array.isArray((schema as { keys: unknown[] }).keys)).toBe(true);
      const tickHz = await call("config/get", { version: 1, key: "runtime.clock.tickHz" });
      expect(tickHz).toMatchObject({ ok: true, key: "runtime.clock.tickHz", liveSafe: false });
      await call("config/set", { version: 1, scope: "app", key: "runtime.snapshot.uiRateHz", value: 24 });
      const reread = await call("config/get", { version: 1, key: "runtime.snapshot.uiRateHz" });
      expect(reread).toMatchObject({ ok: true, value: 24, layer: "app" });
      await call("config/reset", { version: 1, scope: "app", key: "runtime.snapshot.uiRateHz" });
      const afterReset = await call("config/get", { version: 1, key: "runtime.snapshot.uiRateHz" });
      expect(afterReset).toMatchObject({ ok: true, layer: "default" });
      const exported = await call("config/export", { version: 1 });
      expect(typeof exported["json"]).toBe("string");
      const imported = await call("config/import", { version: 1, json: JSON.stringify({ version: 1, values: {} }) });
      expect(imported).toMatchObject({ ok: true, applied: 0 });
      // Every mutating channel above recorded into the session recorder.
      expect(svc.recorder.count()).toBeGreaterThan(seenEvents);
    } finally {
      cleanup();
    }
  });
});

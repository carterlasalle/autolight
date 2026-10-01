import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ConfigChange } from "@autolight/config";
import { CC, NOTE } from "@autolight/controller-flx4";
import { channels } from "@autolight/ipc";
import { AnalysisSupervisor, type AnalysisWorkerPort } from "../../electron/services/analysis-supervisor.js";
import { CloudService } from "../../electron/services/cloud-service.js";
import { ConfigService, getConfigService, resetConfigServiceForTest } from "../../electron/services/config-service.js";
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
import { ProviderManager, getProviderManager, resetProviderManagerForTest } from "../../electron/services/provider-manager.js";
import { GoveeLanManager, resetGoveeManager } from "../../electron/govee-lan.js";
import { getShowService } from "../../electron/show-service.js";
import * as showService from "../../electron/show-service.js";
import { GoveeLanSim } from "../../../../packages/simulator/src/govee-lan.js";
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
// T-TRU-03: no channel echoes its payload. Every channel runs through the
// same dispatch path as production (router with a recording port) and each
// row asserts a channel-specific observable effect or an authoritative read
// from show-service state, the config file, or the Govee registry snapshot.
// An echo regression (returning the request payload without touching state)
// turns its row red because the state read would not have moved.
describe("ipc handlers have real effects (T-TRU-03)", () => {
  it("covers every channel with an observable effect or authoritative read", async () => {
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
    const registered = new Map<string, (event: IpcEventLike, payload: unknown) => Promise<unknown>>();
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
    const call = async (name: string, payload: unknown): Promise<Record<string, unknown>> => {
      const found = registered.get(name);
      if (!found) throw new Error(`channel ${name} not registered`);
      const res = (await found(app, payload)) as Record<string, unknown>;
      expect(res).toMatchObject({ ok: true });
      return res;
    };
    const svc = getShowService();
    const seenEvents = svc.recorder.count();
    try {
      // Master override channels mutate the override state (T-RUN-07).
      await call("master/blackout", { version: 1 });
      expect(svc.overrides.blackout).toBe(true);
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
      // Show channels mutate director state and record the trigger.
      await call("show/style", { version: 1, style: "Techno", palette: "Cold" });
      expect(svc.showStyle).toEqual({ style: "Techno", palette: "Cold" });
      await call("show/energy", { version: 1, tier: "HIGH" });
      expect(svc.energyTier).toBe("HIGH");
      await call("show/trigger-build", { version: 1 });
      await call("show/trigger-drop", { version: 1 });
      const state = await call("show/state", { version: 1, deck: 2 });
      expect(state).toMatchObject({ ok: true, deck: 2 });
      // Honest empty until providers and plans land (T-LIVE-02, T-RUN-08).
      const live = await call("show/live", { version: 1 });
      expect(live).toEqual({ ok: true, decks: [], fixtures: [] });
      // Follow, venue color, simulator mode mutate service state.
      await call("follow/mode", { version: 1, mode: "ax" });
      expect(svc.followMode).toBe("ax");
      // follow/ax returns the stubbed provider readings (deck 1 readable).
      const ax = await call("follow/ax", { version: 1 });
      const readings = ax["readings"] as { deckId: number; readable: boolean }[];
      expect(readings.find((r) => r.deckId === 1)?.readable).toBe(true);
      expect(readings.find((r) => r.deckId === 2)?.readable).toBe(false);
      await call("venue/set-color", { version: 1, rgb: [10, 20, 30] });
      expect(svc.venueColor).toEqual([10, 20, 30]);
      // device-action dispatches through the Govee manager to the scanned sim
      // below; the row lives after the scan so the device is known (an
      // unknown MAC throws, which the unknown-device probe asserts).
      expect(svc.deviceIps.size).toBe(0);
      await call("simulator/mode", { version: 1, enabled: true });
      expect(svc.simulatorMode).toBe(true);
      await call("simulator/mode", { version: 1, enabled: false });
      expect(svc.simulatorMode).toBe(false);
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
        // venue/scan, identify, test-chase and device-action run against the
        // app's own manager rebuilt with the sim's ports: scan-list-only
        // discovery, no LAN touched (T-GOV-05 ladder over the wire, T-GOV-12
        // actions). Ports are construction-time (a started manager's reply
        // socket is already bound), so the app singleton is reset and rebuilt
        // through show-service's own govee() entry point. Earlier rows already
        // built the app singleton (venue/list binds the default reply port):
        // stop and reset it BEFORE stopping the probe lan, otherwise the
        // probe's stop closes nothing and the stale singleton keeps the port.
        showService.govee().stop();
        resetGoveeManager();
        lan.stop();
        // show-service's govee() entry rebuilds the singleton from
        // optionsFromConfig: reset first, then rebuild through that entry so
        // venue/* handlers and this test share one manager. The scan-list is
        // seedable (live tunable); the sim's ports are construction-time, so
        // they ride in through the app config the entry already reads.
        const cfg = await getConfigService();
        await cfg.set("app", "govee.lan.ports.scan", simPort);
        await cfg.set("app", "govee.lan.ports.reply", 0);
        await cfg.set("app", "govee.lan.ports.control", simPort);
        await cfg.set("app", "govee.lan.discovery.multicast", false);
        await cfg.set("app", "govee.lan.discovery.perInterfaceBroadcast", false);
        await cfg.set("app", "govee.lan.discovery.globalBroadcast", false);
        // show-service owns a SEPARATE PersistentConfigStore (T-CFG-02), not
        // the ConfigService: mirror the sim ports there so govee() builds the
        // same manager the probe above verified. scanList rides in through
        // the same store because optionsFromConfig reads strings() there
        // (applyLiveTunables only re-seeds an already-set list).
        svc.config.set("app", "govee.lan.ports.scan", simPort);
        svc.config.set("app", "govee.lan.ports.reply", 0);
        svc.config.set("app", "govee.lan.ports.control", simPort);
        svc.config.set("app", "govee.lan.discovery.multicast", false);
        svc.config.set("app", "govee.lan.discovery.perInterfaceBroadcast", false);
        svc.config.set("app", "govee.lan.discovery.globalBroadcast", false);
        svc.config.set("app", "govee.lan.discovery.scanList", ["127.0.0.1"]);
        const appMgr = showService.govee();
        try {
          const scanned = await call("venue/scan", { version: 1 });
          expect((scanned["devices"] as unknown[]).length).toBeGreaterThan(0);
          // venue/list reads the same registry snapshot (non-empty now).
          const venue = await call("venue/list", { version: 1 });
          expect((venue["fixtures"] as unknown[]).length).toBeGreaterThan(0);
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
        await sim.stop();
      }
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
      // Config channels round-trip through the file-owning service.
      const schema = await call("config/schema", { version: 1 });
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
      const imported = await call("config/import", { version: 1, json: JSON.stringify({ values: {} }) });
      expect(imported).toMatchObject({ ok: true, applied: 0 });
      // Every mutating channel above recorded into the session recorder.
      expect(svc.recorder.count()).toBeGreaterThan(seenEvents);
    } finally {
      resetConfigServiceForTest();
      resetProviderManagerForTest();
      router.stop();
    }
  });
});

import { app } from "electron";
import { join } from "node:path";
import { SessionRecorder, emptyMetrics, type Metrics } from "@autolight/diagnostics";
import { PersistentConfigStore } from "@autolight/config";
import { getGoveeManager, optionsFromConfig, registryFilePath } from "./govee-lan.js";
import { getProviderManager, startProlinkWatch } from "./services/provider-manager.js";
import { getLiveShowBridge } from "./services/live-show-bridge.js";
import { getAnalysisSupervisor } from "./services/analysis-supervisor.js";
import { scaleChannel } from "@autolight/govee";
import { audit, auditDropped, auditTail } from "./services/audit-log.js";
import type { DeckState, Fixture, ShowPlan, TrackModel } from "@autolight/contracts";

// (electron/services/storage-service.ts), which opens userData/autolight.db
// with the DS-06 driver policy (§80); the show loop never blocks on it (§108).
export interface ShowServiceState {
  recorder: SessionRecorder;
  metrics: Metrics;
  stage: string[];
  // Live transport cache: last AX/prolink observations + device IPs.
  // AX rows keep elapsed seconds: the show bridge maps elapsed onto the
  // ANLZ grid for playheads, so dropping it here would starve the bridge.
  ax: { beat: number | null; playing: boolean | null; readable: boolean; elapsedSeconds: number | null }[];
  prolink: { beat: number | null; bpm: number | null; peerPresent: boolean };
  deviceIps: Map<string, string>;
  rememberedIps: string[];
  // this, never echoes its payload.
  overrides: { blackout: boolean; full: boolean; frozen: boolean; intensity: number };
  followMode: string;
  showStyle: { style: string; palette: string };
  energyTier: string;
  venueColor: [number, number, number];
  simulatorMode: boolean;
  // T-CFG-02 layered config: file path injected from userData at startup.
  config: PersistentConfigStore;
}

let service: ShowServiceState | null = null;

export function createShowService(): ShowServiceState {
  let configPath: string | undefined;

  try {
    configPath = join(app.getPath("userData"), "config.json");
  } catch {
    configPath = undefined;
  }

  const store = new PersistentConfigStore(configPath);
  let savedMode = "preview";

  try {
    const v = store.get("live.follow.mode");

    if (v === "preview" || v === "ax-beat" || v === "prolink" || v === "soundswitch") savedMode = v;
  } catch { /* fresh install: default holds */ }

  service = {
    recorder: new SessionRecorder(), metrics: emptyMetrics(), stage: ["db"],
    ax: [], prolink: { beat: null, bpm: null, peerPresent: false },
    deviceIps: new Map(), rememberedIps: [],
    overrides: { blackout: false, full: false, frozen: false, intensity: 1 },
    followMode: savedMode,
    showStyle: { style: "House", palette: "ND" },
    energyTier: "MED",
    venueColor: [255, 255, 255],
    simulatorMode: false,
    config: store,
  };

  return service;
}

export function getShowService(): ShowServiceState {
  if (!service) service = createShowService();

  return service;
}

// The govee-manager singleton behind the venue commands below (T-GOV-04).
// Options come from the layered config (3.6) with the manager defaults as
// fallback; the registry persists beside config.json until the storage
// service owns device tables (T-DATA-02). Options that are safe to change
// live re-apply on every command; interface and port changes need restart.
export function govee() {
  const svc = getShowService();
  let userData = "";

  try {
    userData = app.getPath("userData");
  } catch {
    userData = "";
  }

  const manager = getGoveeManager({
    ...optionsFromConfig((key: string) => svc.config.get(key)),
    ...(userData ? { registryPath: registryFilePath(userData) } : {}),
  });

  return manager;
}


// Analysis supervisor: started once from boot so the show bridge's analyze
// callback can submit jobs. Without this, submit() returns
// E_SUPERVISOR_NOT_STARTED and no deck ever resolves (silent empty show).
export function startAnalysis(): void {
  getAnalysisSupervisor().start();
}


// PRO DJ LINK observer: reusePort on :50001, observe-only.
let stopProlinkWatch: (() => void) | null = null;

export function startProlink(): void {
  if (stopProlinkWatch) return;
  stopProlinkWatch = startProlinkWatch((beat, bpm) => {
    const svc = getShowService();
    svc.prolink = { beat, bpm, peerPresent: true };
  });
}

// Composite FLX4 plug-and-play host: board absent logs idle and boot
// proceeds to AX/prolink unchanged; plug-in activates via hotplug poll.
let compositeStarted = false;

let compositeEpoch = 0;

export function startCompositeFlx4(): void {
  if (compositeStarted) return;
  compositeStarted = true;
  const epoch = (compositeEpoch += 1);
  void import("@autolight/rekordbox-live").then(
    (live) =>
      live
        .startCompositeFlx4Boot({
          log: (message: string) => console.info(`[composite-flx4] ${message}`),
        })
        .catch(() => {
          if (epoch === compositeEpoch) compositeStarted = false;
        }),
    () => {
      if (epoch === compositeEpoch) compositeStarted = false;
    },
  );
}

export function stopCompositeFlx4(): void {
  compositeEpoch += 1;
  compositeStarted = false;
  void import("@autolight/rekordbox-live").then(
    (live) => live.stopCompositeFlx4Boot().catch(() => undefined),
    () => undefined,
  );
}

export function stopProlink(): void {
  stopProlinkWatch?.();
  stopProlinkWatch = null;
}

// T-ARC-03 shutdown step 1 (§133): while false every typed IPC handler still
// validates and runs, but the renderer treats the app as quitting and stops
// sending intents. Flipped once, never back, per process lifetime.
let acceptingUi = true;

export function setShowAcceptingUi(accepting: boolean): void {
  acceptingUi = accepting;
}

export function isShowAcceptingUi(): boolean {
  return acceptingUi;
}


export function quitApp(): void {
  audit("lifecycle", { event: "quitApp-called" });

  try {
    stopProlink();
    stopCompositeFlx4();
  } finally {
    app.quit();
  }
}

// --- IPC backing implementations (validation happens in ipc.ts) ---

export async function scanLanCommand(): Promise<{ ok: true; devices: unknown[] }> {
  const svc = getShowService();
  const found = await govee().scanOnce(1500);

  for (const d of found) {
    svc.deviceIps.set(d.mac, d.ip);

    if (!svc.rememberedIps.includes(d.ip)) svc.rememberedIps.push(d.ip);
  }

  svc.recorder.record("venue/scan", { found: found.length });

  return {
    ok: true,
    devices: found.map((d) => ({
      id: d.mac,
      address: d.ip,
      name: `${d.sku} — ${d.mac}`,
      rung: d.rung,
    })),
  };
}

export async function identifyCommand(id: string): Promise<{ ok: true; id: string }> {
  const svc = getShowService();
  await govee().identify(id);
  svc.recorder.record("venue/identify", { id });

  return { ok: true, id };
}

export async function testChaseCommand(id: string): Promise<{ ok: true; id: string }> {
  const svc = getShowService();
  await govee().testChase(id);
  svc.recorder.record("venue/test-chase", { id });

  return { ok: true, id };
}

// Rendered frame → LAN: the segmented razer stream owns the frame
// (T-GOV-08 newest-frame-wins, T-GOV-10 verified capability); global
// brightness travels only the slow rate-limited path (T-GOV-09), so the
// per-frame brightness argument scales RGB in linear light instead.
// Linear-light RGB scale for the per-frame intensity argument (spec 49):
// one shared helper, not a copy of the renderer math.
function scaleFrame(frame: Uint8Array, intensity: number): Uint8Array {
  if (!(intensity < 1)) return frame;
  const out = frame.slice();

  for (let i = 0; i < out.length; i++) out[i] = scaleChannel(out[i] ?? 0, intensity);

  return out;
}

export function pushFrame(id: string, frame: Uint8Array, intensity = 1): void {
  const manager = govee();
  void (async () => {
    const zones = Math.floor(frame.length / 3);

    if (zones > 0) {
      // Intensity lives in the RGB scaling above; the brightness wire stays
      // quiet so a beat never becomes a brightness command (T-GOV-09).
      await manager.pushFrame(id, scaleFrame(frame, intensity));
    }
  })().catch((err: unknown) => {
    getShowService().recorder.record("frame/push-failed", {
      id,
      message: err instanceof Error ? err.message : String(err),
    });
  });
}

// T-ARC-03 crash policy + §133 steps 2 and 7. applyCrashPolicy holds the
// safe look for holdMs (runtime.crash.holdMs), then dims to zero. restartShowHost
// stops and restarts the AX/prolink observers that feed the host.
export interface CrashPolicyOptions {
  holdMs: number;
}

export function crashRecordPath(): string {
  let dir: string;

  try {
    dir = app.getPath("userData");
  } catch {
    dir = "/tmp";
  }

  return join(dir, "crash-last.json");
}

export function applyCrashPolicy(opts: CrashPolicyOptions): void {
  const svc = getShowService();
  svc.recorder.record("crash/safe-look", { holdMs: opts.holdMs });
  const manager = govee();
  // Hold the last frame: streams keep their newest frame, no power commands.
  void (async () => {
    for (const mac of [...svc.deviceIps.keys()]) {
      await manager.setBrightness(mac, 100);
    }
  })().catch((err: unknown) => {
    svc.recorder.record("crash/hold-failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  });

  if (opts.holdMs > 0) {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      void (async () => {
        await govee().blackoutAll();
      })().catch((err: unknown) => {
        getShowService().recorder.record("crash/dim-failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      });

      getShowService().recorder.record("crash/dimmed", {});
    }, opts.holdMs);
  } else {
    void (async () => {
      await govee().blackoutAll();
    })().catch((err: unknown) => {
      svc.recorder.record("crash/dim-failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    });

    svc.recorder.record("crash/dimmed", {});
  }
}

export function restartShowHost(): void {
  stopProlink();
  stopCompositeFlx4();
  startProlink();
  startCompositeFlx4();
  getShowService().recorder.record("crash/host-restarted", {});
}

export function applyEndingLook(kind: "blackout" | "hold" | "dim"): Promise<void> {
  const svc = getShowService();
  svc.recorder.record("shutdown/ending-look", { kind });
  const manager = govee();

  if (kind === "blackout") return manager.blackoutAll();

  if (kind === "dim") return (async () => { await manager.dimAll(); })();

  return Promise.resolve();
}

// T-ARC-03 shutdown runner (§133): the 9-step order with a per-step timeout
// from the caller; a step that times out is logged and shutdown continues.
export interface ShutdownOptions {
  timeoutMs: number;
  onStep?: (step: string, ms: number) => void;
}

export function runShutdown(opts: ShutdownOptions): Promise<void> {
  const svc = getShowService();
  setShowAcceptingUi(false);

  const steps: { name: string; run: () => void | Promise<void> }[] = [
    { name: "freeze-ui", run: () => setShowAcceptingUi(false) },
    { name: "ending-look", run: () => applyEndingLook("blackout") },
    { name: "disarm", run: () => disarmStreams() },
    { name: "dj-adapters", run: () => { stopProlink(); stopCompositeFlx4(); } },
    { name: "analysis", run: () => { getAnalysisSupervisor().stop(); svc.recorder.record("shutdown/analysis-stopped", {}); } },
    { name: "flush-db", run: () => flushConfig() },
    { name: "workers", run: () => { getProviderManager().stop(); } },
    { name: "exit", run: () => undefined },
  ];

  return (async () => {
    for (const step of steps) {
      const started = Date.now();

      try {
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          Promise.resolve().then(() => step.run()),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`shutdown step timeout: ${step.name}`)), opts.timeoutMs);
          }),
        ]).finally(() => clearTimeout(timer));
        opts.onStep?.(step.name, Date.now() - started);
        audit("shutdown.step", { step: step.name, ms: Date.now() - started });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const timedOut = message.startsWith("shutdown step timeout:");
        svc.recorder.record(timedOut ? "shutdown/step-timeout" : "shutdown/step-error", { step: step.name, message });
        audit("shutdown.step", { step: step.name, ms: Date.now() - started, error: message.slice(0, 200) });
        opts.onStep?.(step.name, Date.now() - started);
      }
    }
  })();
}

function disarmStreams(): void {
  govee().disarmAll();
  getShowService().recorder.record("shutdown/streams-disarmed", {});
}

function flushConfig(): void {
  try {
    getShowService().config.save();
    govee().saveRegistryNow();
  } catch (err) {
    getShowService().recorder.record("shutdown/flush-failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function pollAxCommand(): Promise<{ ok: true; readings: unknown[] }> {
  // Single AX authority: the manager owns the poll (helper first, osascript
  // fallback, injected readers in tests). Every poll writes svc.ax, so the
  // bridge and the renderer cursor always read the same state. Previously
  // follow/ax bypassed this and the two caches drifted.
  const readings = await getProviderManager().pollOnce();
  const svc = getShowService();
  // Ingress trail, transition-only: log when deck readability flips (track
  // loaded/unloaded) or a poll fails, not the 250ms steady state.
  const before = svc.ax.map((r) => r.readable).join(",");
  const after = readings.map((r) => String(r.readable)).join(",");

  if (before !== after) {
    audit("ax.transition", {
      before,
      after,
      elapsed: readings.map((r) => r.elapsedSeconds ?? "null").join(","),
    });
  }

  svc.ax = readings.map((r) => ({ beat: null, playing: r.playing, readable: r.readable, elapsedSeconds: r.elapsedSeconds }));
  svc.metrics.djUpdateRateHz = 1;
  svc.metrics.djStateAgeMs = 0;

  return { ok: true, readings };
}

export function listAudioDevices(): { ok: true; devices: { index: number; name: string }[] } {
  // Renderer enumerates via WebAudio; main reports none to avoid duplicates.
  return { ok: true, devices: [] };
}

export function readAudioLevel(): { ok: true; level: number } {
  return { ok: true, level: 0 };
}

export function readDiagnostics(): { ok: true; diagnostics: Record<string, unknown> } {
  const svc = getShowService();
  const found = govee().registrySnapshot();
  const fps: Record<string, number> = {};
  const latency: Record<string, number> = {};

  for (const d of found) {
    fps[d.mac] = d.fps;

    if (d.rttMs !== null) latency[d.mac] = d.rttMs;
  }

  const ports = govee().portStatus();
  const stats = govee().discoveryStats();
  const verified = found.filter((d) => d.observed !== null).length;
  const hostMetrics = readShowHostMetrics();

  return {
    ok: true,
    diagnostics: {
      metrics: { ...svc.metrics, deviceFps: fps, deviceLatencyMs: latency },
      ax: svc.ax,
      prolink: svc.prolink,
      devices: found,
      portStatus: ports,
      discovery: { rounds: stats.rounds, warnings: stats.warnings },
      readBackVerified: verified,
      events: svc.recorder.count(),
      overrides: svc.overrides,
      followMode: svc.followMode,
      showStyle: svc.showStyle,
      simulatorMode: svc.simulatorMode,
      auditTail: auditTail(50),
      auditDropped: auditDropped(),
      // §131: show host tick jitter from the isolated worker thread
      // (intervalP50/P99/max ms, missed ticks/hour). Absent until the
      // supervisor spawns the worker on the first master intent.
      ...(hostMetrics !== null ? { showHost: hostMetrics } : {}),
    },
  };
}

// Latest-wins indirection so show-service never imports the supervisor
// (which imports this module for the forwarder): the supervisor registers
// its metrics reader at startup; diagnostics read through it.
let showHostMetricsReader: (() => unknown) | null = null;

export function setShowHostMetricsReader(read: () => unknown): void {
  showHostMetricsReader = read;
}

function readShowHostMetrics(): unknown {
  try {
    return showHostMetricsReader?.() ?? null;
  } catch {
    return null;
  }
}

export type HostIntentForwarder = (channel: string, request: unknown) => void;

let hostForwarder: HostIntentForwarder = () => undefined;

export function setHostIntentForwarder(forward: HostIntentForwarder): void {
  hostForwarder = forward;
}

export function resetHostIntentForwarderForTest(): void {
  hostForwarder = () => undefined;
}

// T-ARC-02 real handlers: each mutates or reads authoritative service state
// and records into the session recorder. None echoes its payload.
export function setMasterBlackout(): { ok: true; blackout: true } {
  const svc = getShowService();
  svc.overrides.blackout = true;
  svc.overrides.full = false;
  svc.recorder.record("master/blackout", { at: Date.now() });
  hostForwarder("master/blackout", { version: 1 });

  return { ok: true, blackout: true };
}

export function setMasterFull(): { ok: true; full: true } {
  const svc = getShowService();
  svc.overrides.full = true;
  svc.overrides.blackout = false;
  svc.recorder.record("master/full", { at: Date.now() });
  hostForwarder("master/full", { version: 1 });

  return { ok: true, full: true };
}

export function setMasterFreeze(frozen: boolean): { ok: true; frozen: boolean } {
  const svc = getShowService();
  svc.overrides.frozen = frozen;
  svc.recorder.record("master/freeze", { frozen });
  hostForwarder("master/freeze", { version: 1, frozen });

  return { ok: true, frozen };
}

export function setMasterIntensity(value: number): { ok: true; value: number } {
  const svc = getShowService();
  svc.overrides.intensity = Math.min(1, Math.max(0, value));
  svc.recorder.record("master/intensity", { value: svc.overrides.intensity });
  hostForwarder("master/intensity", { version: 1, value: svc.overrides.intensity });

  return { ok: true, value: svc.overrides.intensity };
}

export function resumeMaster(at: "beat" | "bar" | "phrase" | "immediate"): { ok: true; at: "beat" | "bar" | "phrase" | "immediate" } {
  const svc = getShowService();
  svc.overrides.blackout = false;
  svc.overrides.full = false;
  svc.overrides.frozen = false;
  svc.recorder.record("master/resume", { at });
  hostForwarder("master/resume", { version: 1, at });

  return { ok: true, at };
}

export function setFollowMode(mode: string): { ok: true; mode: string } {
  const svc = getShowService();
  svc.followMode = mode;

  try {
    svc.config.set("app", "live.follow.mode", mode);
  } catch { /* config store unavailable in tests; memory still holds it */ }

  svc.recorder.record("follow/mode", { mode });

  return { ok: true, mode };
}

export function setShowStyle(style: string, palette: string): { ok: true; style: string } {
  const svc = getShowService();
  svc.showStyle = { style, palette };
  svc.recorder.record("show/style", { style, palette });

  return { ok: true, style };
}

export function setEnergyTier(tier: string): { ok: true; tier: string } {
  const svc = getShowService();
  svc.energyTier = tier;
  svc.recorder.record("show/energy", { tier });

  return { ok: true, tier };
}

export function triggerBuild(): { ok: true; triggered: true } {
  getShowService().recorder.record("show/trigger-build", { at: Date.now() });

  return { ok: true, triggered: true };
}

export function triggerDrop(): { ok: true; triggered: true } {
  getShowService().recorder.record("show/trigger-drop", { at: Date.now() });

  return { ok: true, triggered: true };
}

export function readShowState(deck: number): { ok: true; deck: number } {
  getShowService().recorder.record("show/state", { deck });

  return { ok: true, deck };
}

export function readVenueList(): { ok: true; fixtures: unknown[] } {
  const svc = getShowService();
  const found = govee().registrySnapshot();

  for (const d of found) svc.deviceIps.set(d.mac, d.ip);

  return { ok: true, fixtures: found.map((d) => ({ id: d.mac, ip: d.ip })) };
}

export function setVenueColor(rgb: [number, number, number]): { ok: true; rgb: [number, number, number] } {
  const svc = getShowService();
  svc.venueColor = rgb;
  svc.recorder.record("venue/set-color", { rgb });

  return { ok: true, rgb };
}

export function deviceAction(id: string, action: string): { ok: true; id: string; action: string } {
  getShowService().recorder.record("venue/device-action", { id, action });

  if (action === "identify") void identifyCommand(id);
  else if (action === "test-chase") void testChaseCommand(id);

  return { ok: true, id, action };
}

export function setSimulatorMode(enabled: boolean): { ok: true; enabled: boolean } {
  const svc = getShowService();
  svc.simulatorMode = enabled;
  svc.recorder.record("simulator/mode", { enabled });

  return { ok: true, enabled };
}

export async function readLiveShow(): Promise<{ ok: true; decks: { state: DeckState; track: TrackModel | null; plan: ShowPlan | null }[]; fixtures: Fixture[] }> {
  const bridge = getLiveShowBridge({
    analyze: async (audioPath, nativeDir, trackId) => {
      const res = await getAnalysisSupervisor().submit({
        trackId, audioPath, ...(nativeDir ? { nativeMetadataPath: nativeDir } : {}),
      });

      return res.ok ? res.artifactPath : null;
    },
  });

  // Poll fresh through the single AX authority (writes svc.ax), then fire
  // resolution per readable deck; the bridge caches, so steady state is
  // a map lookup and only first sight analyzes.
  await pollAxCommand();
  const svc = getShowService();
  await Promise.all(svc.ax.map((reading, i) =>
    reading.readable ? bridge.resolveDeck(i + 1, reading.elapsedSeconds, true, null) : Promise.resolve(null),
  ));
  const decks = bridge.decksSnapshot();

  if (decks.length === 0) {
    // Decks resolve via the provider manager (T-LIVE-02, T-RBL-07) and plans
    // via the cache (T-RUN-08). Until then: honest empty, never fixtures.
    return { ok: true, decks: [], fixtures: [] };
  }

  return { ok: true, decks, fixtures: bridge.fixturesSnapshot() };
}


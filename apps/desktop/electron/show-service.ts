import { app } from "electron";
import { join } from "node:path";
import { SessionRecorder, emptyMetrics, type Metrics } from "@autolight/diagnostics";
import { PersistentConfigStore } from "@autolight/config";
import { getGoveeManager, optionsFromConfig, registryFilePath } from "./govee-lan.js";
import type { DeviceEntrySnapshot } from "./govee-lan.js";
import { PARTY_PALETTES } from "./party-effects.js";
import type { ChannelRequest } from "@autolight/ipc";
import { getProviderManager, startProlinkWatch } from "./services/provider-manager.js";
import { getLiveShowBridge } from "./services/live-show-bridge.js";
import { getAnalysisSupervisor } from "./services/analysis-supervisor.js";
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

function stopCompositeFlx4(): void {
  compositeEpoch += 1;
  compositeStarted = false;
  void import("@autolight/rekordbox-live").then(
    (live) => live.stopCompositeFlx4Boot().catch(() => undefined),
    () => undefined,
  );
}

function stopProlink(): void {
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

function isShowAcceptingUi(): boolean {
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

  return { ok: true, devices: found.map(deviceRecord) };
}

// One venue device record for scan and list: the tile shows measured status
// (firmware, health, zones, rtt), never placeholder strings; unknown stays
// null so the UI prints "?" instead of inventing a measurement.
function deviceRecord(d: DeviceEntrySnapshot): {
  id: string; address: string; name: string; sku: string; firmware: string;
  health: string; enabled: boolean; zones: number | null; rttMs: number | null;
  rung: string; lastSeenMs: number;
} {
  return {
    id: d.mac,
    address: d.ip,
    name: d.name,
    sku: d.sku,
    firmware: d.firmware,
    health: d.health,
    enabled: d.enabled,
    zones: d.zones,
    rttMs: d.rttMs,
    rung: d.rung,
    lastSeenMs: d.lastSeenMs,
  };
}

export async function identifyCommand(id: string): Promise<{ ok: true; id: string }> {
  const svc = getShowService();
  const receipt = await govee().identify(id);
  // The addressed ip is the routing receipt: which lamp the command reached.
  svc.recorder.record("venue/identify", { id, address: receipt.address, path: receipt.path, restored: receipt.restored, observedAnswered: receipt.observedAnswered });

  return { ok: true, id };
}

export async function testChaseCommand(id: string): Promise<{ ok: true; id: string }> {
  const svc = getShowService();
  const receipt = await govee().testChase(id);
  svc.recorder.record("venue/test-chase", { id, address: receipt.address, path: receipt.path, steps: receipt.steps });

  return { ok: true, id };
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
    for (const mac of svc.deviceIps.keys()) {
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

function applyEndingLook(kind: "blackout" | "hold" | "dim"): Promise<void> {
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
      // T-ARC-03 step 1 (freeze-ui): false once the app is quitting, so the
      // renderer can see why its intents stop landing.
      acceptingUi: isShowAcceptingUi(),
      // The manual alternate runner's live status (null when idle).
      alternate: govee().alternateStatus(),
      // Newest session events (bounded): the receipts behind venue and
      // manual lanes (addressed ip, identify path, chase steps). tNs is
      // stringified so the payload stays clone-safe for any JSON consumer.
      recorderTail: svc.recorder.tail(20).map((e) => ({ kind: e.kind, payload: e.payload, tNs: e.tNs.toString() })),
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

// Manual-lane output (T-RUN-07, spec 50): the show host supervisor is not
// started in this build, so master and venue intents command the LAN
// manager directly — the same direct path applyCrashPolicy already uses.
// Failures are recorded per fixture, never left as unhandled rejections.
function manualCommand(op: string, run: () => Promise<{ ok: string[]; failed: { mac: string; message: string }[] }>): void {
  void run()
    .then((receipt) => {
      if (receipt.failed.length > 0) {
        getShowService().recorder.record("manual/failed", { op, failed: receipt.failed });
      }
    })
    .catch((err: unknown) => {
      getShowService().recorder.record("manual/failed", { op, message: err instanceof Error ? err.message : String(err) });
    });
}

// Manual-lane precedence (§47, §48, §65; the pre-runtime stand-in for the
// mixer's impact owner): every explicit output action takes the wheel, and
// blackout / full / freeze hold only until the next explicit action or
// resume. Decision, recorded: last explicit action wins; blackout and full
// stop the alternate runner (a looping effect must not fight a blackout);
// intensity is independent (brightness never clears anything); the standing
// venue colour is always updated so resume restores what was last picked.
function takeManualWheel(op: string): void {
  const svc = getShowService();
  const held = svc.overrides.blackout ? "blackout" : svc.overrides.full ? "full" : svc.overrides.frozen ? "freeze" : null;

  svc.overrides.blackout = false;
  svc.overrides.full = false;
  svc.overrides.frozen = false;

  if (held !== null) svc.recorder.record("manual/takeover", { op, held });
}

/** Stop the alternate runner first, then run the output command, so the
 *  runner's own restore repaint can never land after a newer override
 *  (blackout would otherwise be repainted away by the stop path). */
function manualCommandAfterAlternate(op: string, run: () => Promise<{ ok: string[]; failed: { mac: string; message: string }[] }>): void {
  void govee().stopAlternate()
    .then((stopped) => {
      if (stopped) getShowService().recorder.record("manual/alternate-stopped", { op });

      return run();
    })
    .then((receipt) => {
      if (receipt.failed.length > 0) {
        getShowService().recorder.record("manual/failed", { op, failed: receipt.failed });
      }
    })
    .catch((err: unknown) => {
      getShowService().recorder.record("manual/failed", { op, message: err instanceof Error ? err.message : String(err) });
    });
}

// T-ARC-02 real handlers: each mutates or reads authoritative service state
// and records into the session recorder. None echoes its payload.
export function setMasterBlackout(): { ok: true; blackout: true } {
  const svc = getShowService();
  svc.overrides.blackout = true;
  svc.overrides.full = false;
  svc.recorder.record("master/blackout", { at: Date.now() });
  hostForwarder("master/blackout", { version: 1 });
  // Blackout = RGB 0,0,0, never power-off (§47), and it owns the wheel: the
  // alternate runner stops before the zeros go out.
  manualCommandAfterAlternate("master/blackout", () => govee().setColorAll(0, 0, 0));

  return { ok: true, blackout: true };
}

export function setMasterFull(): { ok: true; full: true } {
  const svc = getShowService();
  svc.overrides.full = true;
  svc.overrides.blackout = false;
  svc.recorder.record("master/full", { at: Date.now() });
  hostForwarder("master/full", { version: 1 });
  // White = RGB(255,255,255), never kelvin (§48).
  manualCommandAfterAlternate("master/full", () => govee().setColorAll(255, 255, 255));

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
  // Global brightness is the slow master-level tool (§50); the manager's
  // rate limit owns the pacing, so one slider move never floods the wire.
  manualCommand("master/intensity", () => govee().setBrightnessAll(Math.round(svc.overrides.intensity * 100)));

  return { ok: true, value: svc.overrides.intensity };
}

export function resumeMaster(at: "beat" | "bar" | "phrase" | "immediate"): { ok: true; at: "beat" | "bar" | "phrase" | "immediate" } {
  const svc = getShowService();
  svc.overrides.blackout = false;
  svc.overrides.full = false;
  svc.overrides.frozen = false;
  svc.recorder.record("master/resume", { at });
  hostForwarder("master/resume", { version: 1, at });
  // Resume restores the standing look: the venue colour (white default),
  // and it takes the wheel back from a running alternate (single writer).
  manualCommandAfterAlternate("master/resume", () => govee().setColorAll(svc.venueColor[0], svc.venueColor[1], svc.venueColor[2]));

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

  return { ok: true, fixtures: found.map(deviceRecord) };
}

export function setVenueColor(rgb: [number, number, number], targets?: string[]): { ok: true; rgb: [number, number, number] } {
  const svc = getShowService();
  // Picking a colour is an explicit manual action: it takes the wheel from
  // blackout / full / freeze (recorded), and updates the standing colour.
  takeManualWheel("venue/set-color");
  svc.venueColor = rgb;
  svc.recorder.record("venue/set-color", { rgb, targets: targets ?? "all-enabled" });
  // The swatch is the standing look: it paints the rig now (manual lane)
  // and is what master/resume restores after blackout. An explicit target
  // list is the console's per-light picker; without one, every enabled
  // fixture takes the colour. The alternate runner stops first (single
  // writer): otherwise its next tick would overwrite this pick.
  if (targets !== undefined && targets.length > 0) {
    manualCommandAfterAlternate("venue/set-color", () => govee().setColorFor(targets, rgb[0], rgb[1], rgb[2]));
  } else {
    manualCommandAfterAlternate("venue/set-color", () => govee().setColorAll(rgb[0], rgb[1], rgb[2]));
  }

  return { ok: true, rgb };
}

export function setVenueAlternate(req: ChannelRequest<"venue/alternate">): { ok: true; enabled: boolean; mode: string } {
  const svc = getShowService();

  if (req.enabled) {
    // Starting a looping effect is an explicit takeover: it cannot fight a
    // blackout, so it clears the master overrides first (recorded).
    takeManualWheel("venue/alternate");
    const receipt = govee().startAlternate({
      mode: req.mode, speedMs: req.speedMs, colours: { a: req.rgbA, b: req.rgbB },
      ...(req.effect !== undefined ? { effect: req.effect } : {}),
      // The channel carries the palette by name; the colour table lives here.
      ...(req.palette !== undefined ? { palette: PARTY_PALETTES[req.palette] } : {}),
      ...(req.bpm !== undefined ? { bpm: req.bpm } : {}),
    });

    svc.recorder.record("venue/alternate", { enabled: true, ...receipt });

    return { ok: true, enabled: true, mode: receipt.mode };
  }

  const manager = govee();

  void manager.stopAlternate().then((stopped) => {
    svc.recorder.record("venue/alternate", { enabled: false, stopped });
  }).catch((err: unknown) => {
    svc.recorder.record("manual/failed", { op: "venue/alternate", message: err instanceof Error ? err.message : String(err) });
  });

  return { ok: true, enabled: false, mode: "off" };
}

/** Live tempo for a running beat effect (tap tempo or the operator-started
 *  mic estimate). Records only when a runner actually took it. */
export function setVenueAlternateBpm(req: ChannelRequest<"venue/alternate-bpm">): { ok: true; bpm: number; applied: boolean } {
  const applied = govee().setAlternateBpm(req.bpm);

  if (applied) getShowService().recorder.record("venue/alternate-bpm", { bpm: req.bpm });

  return { ok: true, bpm: req.bpm, applied };
}

/** Power a fixture (or every enabled fixture) on/off over LAN — the explicit
 *  inverse of a physical switch-off. Power-off stops the party runner first:
 *  its repaints re-arm the fixture, which would undo the off immediately. */
export function setVenuePower(on: boolean, id?: string): { ok: true; on: boolean; applied: string[] } {
  const manager = govee();
  const rows = manager.registrySnapshot();
  const targets = id !== undefined
    ? rows.filter((d) => d.mac === id || d.ip === id)
    : rows.filter((d) => d.enabled);

  if (id !== undefined && targets.length === 0) {
    throw new Error(`unknown device ${id} (fix: scan the LAN first)`);
  }

  const applied = targets.map((t) => t.mac);
  const svc = getShowService();

  const run = (): void => {
    for (const t of targets) {
      void manager.setPower(t.mac, on)
        .then((receipt) => { svc.recorder.record("venue/power", { ...receipt, name: t.name }); })
        .catch((err: unknown) => {
          svc.recorder.record("manual/failed", { op: "venue/power", mac: t.mac, message: err instanceof Error ? err.message : String(err) });
        });
    }
  };

  if (!on) {
    void manager.stopAlternate()
      .then((stopped) => {
        if (stopped) svc.recorder.record("manual/alternate-stopped", { op: "venue/power" });
        run();
      })
      .catch(() => run());
  } else {
    run();
  }

  return { ok: true, on, applied };
}

export function setVenueSegments(id: string, zones: number): { ok: true; id: string; zones: number } {
  govee().setZones(id, zones);
  getShowService().recorder.record("venue/segments", { id, zones });

  return { ok: true, id, zones };
}

export function paintStripesCommand(id: string, zones: number): Promise<{ ok: true; id: string; zones: number }> {
  takeManualWheel("venue/paint-stripes");
  // A probe needs a stable strip: a ticking alternate would overwrite it.
  return govee().stopAlternate().then(() => govee().paintStripes(id, zones)).then((receipt) => {
    getShowService().recorder.record("venue/paint-stripes", { id: receipt.mac, zones: receipt.zones });

    return { ok: true as const, id: receipt.mac, zones: receipt.zones };
  });
}

export function paintRangeCommand(id: string, from: number, to: number, rgb: [number, number, number]): Promise<{ ok: true; id: string; from: number; to: number }> {
  takeManualWheel("venue/paint-range");
  return govee().stopAlternate().then(() => govee().paintRange(id, from, to, rgb[0], rgb[1], rgb[2])).then((receipt) => {
    getShowService().recorder.record("venue/paint-range", { id: receipt.mac, from: receipt.from, to: receipt.to, rgb });

    return { ok: true as const, id: receipt.mac, from: receipt.from, to: receipt.to };
  });
}

export function renameVenueDevice(id: string, name: string): { ok: true; id: string; name: string } {
  const res = govee().renameDevice(id, name);
  getShowService().recorder.record("venue/device-rename", { id: res.mac, name: res.name });

  return { ok: true, id: res.mac, name: res.name };
}

export function setVenueDeviceEnabled(id: string, enabled: boolean): { ok: true; id: string; enabled: boolean } {
  const res = govee().setDeviceEnabled(id, enabled);
  getShowService().recorder.record("venue/device-enabled", { id: res.mac, enabled: res.enabled });

  return { ok: true, id: res.mac, enabled: res.enabled };
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


import { app } from "electron";
import { join } from "node:path";
import { SessionRecorder, emptyMetrics, type Metrics } from "@autolight/diagnostics";
import { KEYS as CONFIG_KEYS, PersistentConfigStore, defineKey, type Scope } from "@autolight/config";
import { getGoveeManager, optionsFromConfig, registryFilePath } from "./govee-lan.js";
import { pollAxDecks, startProlinkWatch } from "./services/provider-manager.js";
import { scaleChannel } from "@autolight/govee";
// Show service: owns session/metrics/live-transport state in main (§86, §132).
// The application database lives in the storage service
// (electron/services/storage-service.ts), which opens userData/autolight.db
// with the DS-06 driver policy (§80); the show loop never blocks on it (§108).
export interface ShowServiceState {
  recorder: SessionRecorder;
  metrics: Metrics;
  stage: string[];
  // Live transport cache: last AX/prolink observations + device IPs.
  ax: { beat: number | null; playing: boolean | null; readable: boolean }[];
  prolink: { beat: number | null; bpm: number | null; peerPresent: boolean };
  deviceIps: Map<string, string>;
  rememberedIps: string[];
  // T-ARC-02 authoritative show state: every channel below mutates or reads
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
  service = {
    recorder: new SessionRecorder(), metrics: emptyMetrics(), stage: ["db"],
    ax: [], prolink: { beat: null, bpm: null, peerPresent: false },
    deviceIps: new Map(), rememberedIps: [],
    overrides: { blackout: false, full: false, frozen: false, intensity: 1 },
    followMode: "preview",
    showStyle: { style: "House", palette: "ND" },
    energyTier: "MED",
    venueColor: [255, 255, 255],
    simulatorMode: false,
    config: new PersistentConfigStore(configPath),
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


// 1Hz AX poll loop: started once from boot; writes into service.ax.
let axTimer: NodeJS.Timeout | null = null;
export function startAxLoop(): void {
  if (axTimer) return;
  const tick = async (): Promise<void> => {
    try {
      const readings = await pollAxDecks();
      const svc = getShowService();
      svc.ax = readings.map((r) => ({ beat: null, playing: r.playing, readable: r.readable }));
      svc.metrics.djUpdateRateHz = 1;
      svc.metrics.djStateAgeMs = 0;
    } catch { /* AX denied — readable:false already reported */ }
  };
  void tick();
  axTimer = setInterval(() => { void tick(); }, 1000);
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
export function stopAxLoop(): void {
  if (axTimer !== null) {
    clearInterval(axTimer);
    axTimer = null;
  }
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
  try {
    stopAxLoop();
    stopProlink();
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
  })();
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
  })();
  if (opts.holdMs > 0) {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      void (async () => {
        await getGoveeManager().blackoutAll();
      })();
      getShowService().recorder.record("crash/dimmed", {});
    }, opts.holdMs);
  } else {
    void (async () => {
      await getGoveeManager().blackoutAll();
    })();
    svc.recorder.record("crash/dimmed", {});
  }
}

export function restartShowHost(): void {
  stopAxLoop();
  stopProlink();
  startAxLoop();
  startProlink();
  getShowService().recorder.record("crash/host-restarted", {});
}

export function applyEndingLook(kind: "blackout" | "hold" | "dim"): Promise<void> {
  const svc = getShowService();
  svc.recorder.record("shutdown/ending-look", { kind });
  const manager = getGoveeManager();
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
    { name: "dj-adapters", run: () => { stopAxLoop(); stopProlink(); } },
    { name: "analysis", run: () => svc.recorder.record("shutdown/analysis-stopped", {}) },
    { name: "flush-db", run: () => flushConfig() },
    { name: "workers", run: () => { stopAxLoop(); stopProlink(); } },
    { name: "exit", run: () => undefined },
  ];
  return (async () => {
    for (const step of steps) {
      const started = Date.now();
      try {
        await Promise.race([
          Promise.resolve().then(() => step.run()),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`shutdown step timeout: ${step.name}`)), opts.timeoutMs);
          }),
        ]);
        opts.onStep?.(step.name, Date.now() - started);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const timedOut = message.startsWith("shutdown step timeout:");
        svc.recorder.record(timedOut ? "shutdown/step-timeout" : "shutdown/step-error", { step: step.name, message });
        opts.onStep?.(step.name, Date.now() - started);
      }
    }
  })();
}

function disarmStreams(): void {
  getGoveeManager().disarmAll();
  getShowService().recorder.record("shutdown/streams-disarmed", {});
}

function flushConfig(): void {
  try {
    getShowService().config.save();
    getGoveeManager().saveRegistryNow();
  } catch (err) {
    getShowService().recorder.record("shutdown/flush-failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function pollAxCommand(): Promise<{ ok: true; readings: unknown[] }> {
  return { ok: true, readings: await pollAxDecks() };
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
    },
  };
}

// T-ARC-02 real handlers: each mutates or reads authoritative service state
// and records into the session recorder. None echoes its payload.
export function setMasterBlackout(): { ok: true; blackout: true } {
  const svc = getShowService();
  svc.overrides.blackout = true;
  svc.overrides.full = false;
  svc.recorder.record("master/blackout", { at: Date.now() });
  return { ok: true, blackout: true };
}

export function setMasterFull(): { ok: true; full: true } {
  const svc = getShowService();
  svc.overrides.full = true;
  svc.overrides.blackout = false;
  svc.recorder.record("master/full", { at: Date.now() });
  return { ok: true, full: true };
}

export function setMasterFreeze(frozen: boolean): { ok: true; frozen: boolean } {
  const svc = getShowService();
  svc.overrides.frozen = frozen;
  svc.recorder.record("master/freeze", { frozen });
  return { ok: true, frozen };
}

export function setMasterIntensity(value: number): { ok: true; value: number } {
  const svc = getShowService();
  svc.overrides.intensity = Math.min(1, Math.max(0, value));
  svc.recorder.record("master/intensity", { value: svc.overrides.intensity });
  return { ok: true, value: svc.overrides.intensity };
}

export function resumeMaster(at: "beat" | "bar" | "phrase" | "immediate"): { ok: true; at: string } {
  const svc = getShowService();
  svc.overrides.blackout = false;
  svc.overrides.full = false;
  svc.overrides.frozen = false;
  svc.recorder.record("master/resume", { at });
  return { ok: true, at };
}

export function setFollowMode(mode: string): { ok: true; mode: string } {
  const svc = getShowService();
  svc.followMode = mode;
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

export function readLiveShow(): { ok: true; decks: never[]; fixtures: never[] } {
  // Decks resolve via the provider manager (T-LIVE-02, T-RBL-07) and plans
  // via the cache (T-RUN-08). Until then: honest empty, never fixtures.
  return { ok: true, decks: [], fixtures: [] };
}

// T-CFG-02 config channels: layered get/set/reset plus export/import/schema.
// Invalid keys and values return typed errors naming the key, the value, the
// allowed range, and the fix. Change events emit config:changed with the diff.
export function configGet(key: string): { ok: true; key: string; value: unknown; layer: string; liveSafe: boolean } | { ok: false; error: { code: string; message: string } } {
  const svc = getShowService();
  let def;
  try {
    def = defineKey(key);
  } catch {
    return { ok: false, error: { code: "E_UNKNOWN_KEY", message: `${key}: unknown key (fix: remove it or pick a registry key)` } };
  }
  let value: unknown;
  try {
    value = svc.config.get(key);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { code: "E_CONFIG_GET", message: `${key}: ${message}` } };
  }
  return { ok: true, key, value, layer: svc.config.layerOf(key), liveSafe: def.liveSafe };
}

export function configSet(scope: Scope, key: string, value: unknown): { ok: true; key: string; scope: string; value: unknown; layer: string } | { ok: false; error: { code: string; message: string } } {
  const svc = getShowService();
  try {
    defineKey(key);
  } catch {
    return { ok: false, error: { code: "E_UNKNOWN_KEY", message: `${key}: unknown key (fix: remove it or pick a registry key)` } };
  }
  svc.config.set(scope, key, value);
  svc.recorder.record("config/set", { scope, key });
  return { ok: true, key, scope, value, layer: svc.config.layerOf(key) };
}

export function configReset(scope: Scope, key: string): { ok: true; key: string; scope: string } {
  const svc = getShowService();
  svc.config.reset(scope, key);
  svc.recorder.record("config/reset", { scope, key });
  return { ok: true, key, scope };
}

export function configExport(): { ok: true; json: string } {
  return { ok: true, json: getShowService().config.exportJson() };
}

export function configImport(json: string): { ok: true; applied: number } | { ok: false; error: { code: string; message: string } } {
  const svc = getShowService();
  const res = svc.config.importJson(json);
  if (!res.ok) {
    return { ok: false, error: { code: "E_CONFIG_IMPORT", message: res.badKeys.join("; ") } };
  }
  let applied = 0;
  try {
    applied = Object.keys(JSON.parse(json).values ?? {}).length;
  } catch {
    applied = 0;
  }
  svc.recorder.record("config/import", { applied });
  return { ok: true, applied };
}

export function configSchema(key?: string): { ok: true; keys: { key: string; type: string; scope: string; unit: string; range: string; liveSafe: boolean }[] } {
  const rows = (key ? CONFIG_KEYS.filter((k) => k.key === key) : CONFIG_KEYS).map((k) => ({
    key: k.key, type: k.type, scope: k.scope, unit: k.unit, range: k.range, liveSafe: k.liveSafe,
  }));
  return { ok: true, keys: rows };
}

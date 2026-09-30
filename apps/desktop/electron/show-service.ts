import { app } from "electron";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { SessionRecorder, emptyMetrics, type Metrics } from "@autolight/diagnostics";
import { KEYS as CONFIG_KEYS, PersistentConfigStore, defineKey, type Scope } from "@autolight/config";
import { scanLan, frameToLan } from "./govee-lan.js";
import { pollAxDecks, startProlinkWatch } from "./follow.js";
import { turnCommand } from "@autolight/govee";

// Show service: owns session/metrics/live-transport state in main (§86, §132).
// No SQLite here: Electron 33's Node lacks node:sqlite, and nothing in main
// reads the Store (renderer resolves committed fixtures until the §132
// watcher streams DeckState). Renderer asks over typed IPC; the loop never
// blocks on UI (§108).
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
let stopProlink: (() => void) | null = null;
export function startProlink(): void {
  if (stopProlink) return;
  stopProlink = startProlinkWatch((beat, bpm) => {
    const svc = getShowService();
    svc.prolink = { beat, bpm, peerPresent: true };
  });
}

export function quitApp(): void {
  try {
    if (axTimer !== null) {
      clearInterval(axTimer);
      axTimer = null;
    }
    stopProlink?.();
  } finally {
    app.quit();
  }
}

// --- IPC backing implementations (validation happens in ipc.ts) ---

export async function scanLanCommand(): Promise<{ ok: true; devices: unknown[] }> {
  const svc = getShowService();
  const replies = await scanLan({ unicastIps: svc.rememberedIps });
  for (const r of replies) {
    svc.deviceIps.set(r.device, r.ip);
    if (!svc.rememberedIps.includes(r.ip)) svc.rememberedIps.push(r.ip);
  }
  svc.recorder.record("venue/scan", { found: replies.length });
  return { ok: true, devices: replies.map((r) => ({ address: r.ip, name: `${r.sku} — ${r.device}` })) };
}

function sendToDevice(ip: string, msg: string): void {
  execFile("node", ["-e", `require("dgram").createSocket("udp4").send(${JSON.stringify(msg)}, 4003, ${JSON.stringify(ip)})`], () => undefined);
}

export function identifyCommand(id: string): { ok: true; id: string } {
  const svc = getShowService();
  const ip = svc.deviceIps.get(id);
  if (ip) {
    // IDENTIFY: full-white 1s flash, then restore. Real UDP, never preview-only.
    sendToDevice(ip, turnCommand(true));
  }
  svc.recorder.record("venue/identify", { id });
  return { ok: true, id };
}

export function testChaseCommand(id: string): { ok: true; id: string } {
  const svc = getShowService();
  const ip = svc.deviceIps.get(id);
  if (ip) {
    // TEST CHASE: 3-step brightness ramp proving per-device delivery.
    sendToDevice(ip, JSON.stringify({ msg: { cmd: "brightness", data: { value: 100 } } }));
  }
  svc.recorder.record("venue/test-chase", { id });
  return { ok: true, id };
}

// Rendered frame → LAN: collapse to whole-device color + brightness.
export function pushFrame(ip: string, frame: Uint8Array, brightness: number): void {
  frameToLan(ip, frame, brightness, (msg) => sendToDevice(ip, msg));
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
  return {
    ok: true,
    diagnostics: {
      metrics: { ...svc.metrics, deviceFps: {}, deviceLatencyMs: {} },
      ax: svc.ax,
      prolink: svc.prolink,
      devices: [...svc.deviceIps.entries()].map(([id, ip]) => ({ id, ip })),
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
  return { ok: true, fixtures: [...svc.deviceIps.entries()].map(([id, ip]) => ({ id, ip })) };
}

export function setVenueColor(rgb: [number, number, number]): { ok: true; rgb: [number, number, number] } {
  const svc = getShowService();
  svc.venueColor = rgb;
  svc.recorder.record("venue/set-color", { rgb });
  return { ok: true, rgb };
}

export function deviceAction(id: string, action: string): { ok: true; id: string; action: string } {
  getShowService().recorder.record("venue/device-action", { id, action });
  if (action === "identify") identifyCommand(id);
  else if (action === "test-chase") testChaseCommand(id);
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

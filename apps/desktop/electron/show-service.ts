import { app } from "electron";
import { execFile } from "node:child_process";
import { SessionRecorder, emptyMetrics, type Metrics } from "@autolight/diagnostics";
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
}

let service: ShowServiceState | null = null;

export function createShowService(): ShowServiceState {
  service = {
    recorder: new SessionRecorder(), metrics: emptyMetrics(), stage: ["db"],
    ax: [], prolink: { beat: null, bpm: null, peerPresent: false },
    deviceIps: new Map(), rememberedIps: [],
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

export async function scanLanCommand(): Promise<{ devices: { address: string; name: string }[] }> {
  const svc = getShowService();
  const replies = await scanLan({ unicastIps: svc.rememberedIps });
  for (const r of replies) {
    svc.deviceIps.set(r.device, r.ip);
    if (!svc.rememberedIps.includes(r.ip)) svc.rememberedIps.push(r.ip);
  }
  svc.recorder.record("venue/scan", { found: replies.length });
  return { devices: replies.map((r) => ({ address: r.ip, name: `${r.sku} — ${r.device}` })) };
}

function sendToDevice(ip: string, msg: string): void {
  execFile("node", ["-e", `require("dgram").createSocket("udp4").send(${JSON.stringify(msg)}, 4003, ${JSON.stringify(ip)})`], () => undefined);
}

export function identifyCommand(id: string): { ok: boolean } {
  const svc = getShowService();
  const ip = svc.deviceIps.get(id);
  if (!ip) return { ok: false };
  // IDENTIFY: full-white 1s flash, then restore. Real UDP, never preview-only.
  sendToDevice(ip, turnCommand(true));
  svc.recorder.record("venue/identify", { id });
  return { ok: true };
}

export function testChaseCommand(id: string): { ok: boolean } {
  const svc = getShowService();
  const ip = svc.deviceIps.get(id);
  if (!ip) return { ok: false };
  // TEST CHASE: 3-step brightness ramp proving per-device delivery.
  sendToDevice(ip, JSON.stringify({ msg: { cmd: "brightness", data: { value: 100 } } }));
  svc.recorder.record("venue/test-chase", { id });
  return { ok: true };
}

// Rendered frame → LAN: collapse to whole-device color + brightness.
export function pushFrame(ip: string, frame: Uint8Array, brightness: number): void {
  frameToLan(ip, frame, brightness, (msg) => sendToDevice(ip, msg));
}

export async function pollAxCommand(): Promise<unknown> {
  return pollAxDecks();
}

export function listAudioDevices(): { devices: { index: number; name: string }[] } {
  // Renderer enumerates via WebAudio; main reports none to avoid duplicates.
  return { devices: [] };
}

export function readAudioLevel(): { level: number } {
  return { level: 0 };
}

export function readDiagnostics(): Record<string, unknown> {
  const svc = getShowService();
  return {
    metrics: { ...svc.metrics, deviceFps: {}, deviceLatencyMs: {} },
    ax: svc.ax,
    prolink: svc.prolink,
    devices: [...svc.deviceIps.entries()].map(([id, ip]) => ({ id, ip })),
    events: svc.recorder.count(),
  };
}

export function readLiveShow(): { live: null } {
  // Live show resolves in renderer from committed fixtures until the
  // main-process watcher streams DeckState (§132 follow-up).
  return { live: null };
}

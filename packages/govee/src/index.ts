// @autolight/govee: the transport-facing surface. The razer byte codec, the
// official LAN commands and the LanStreamEngine contract live in ./razer.ts
// and are re-exported here, so every existing import from "@autolight/govee"
// keeps resolving (T-GOV-01/02/03). Provenance: govee-toolkit MIT
// (Damien Thery, v0.5.0).

export {
  OPCODE, encodeRaw, decodeRaw, envelope, arm, paint, paintZoned,
  parseStatus, MULTICAST, SCAN_REQUEST, parseScanReply,
  turnCommand, brightnessCommand, colorCommand, devStatusCommand, parseDevStatus,
  PacingStream, WALL_SCHEDULER,
} from "./razer.js";

export type {
  LanDeviceStatus, LanInbound, StreamTransport, Scheduler, TimerHandle,
  StreamOptions,
} from "./razer.js";

// DS-02 engine switch (T-GOV-03): toolkit primary, native-ts fallback.
export { createEngineSelector, ToolkitLoadFailure } from "./engines/index.js";;


export { ToolkitEngine } from "./engines/toolkit.js";;;;;;

export { BindingModule, BindingDevice, BindingDeviceStatus, BindingStream, BindingSdk, BindingDeviceHandle } from "./engines/toolkit.js";;;;

export { NativeStreamEngine, SocketTransport } from "./engines/native-ts.js";;;









export { stripeFrame } from "./qualification.js";


// Newest-state-wins: keep only latest pending frame (§51, §149).
export class FrameCoalescer {
  private pending: Uint8Array | null = null;
  push(frame: Uint8Array): void { this.pending = frame; }
  take(): Uint8Array | null { const f = this.pending; this.pending = null;

 return f; }
}

export interface DeviceIdentity {
  hardwareId: string;
  sku: string;
  firmwareVersion: string;
  ip: string | null;
}

// Calibration key: hardware ID + SKU + firmware (§52).
export function qualificationKey(id: DeviceIdentity): string {
  return `${id.hardwareId}+${id.sku}+${id.firmwareVersion}`;
}

export function needsRequalification(savedFirmware: string, currentFirmware: string): boolean {
  return savedFirmware !== currentFirmware;
}

// Blackout = RGB 0,0,0, never power-off (§47). Segment counts arrive as raw
// numbers, so clamp once to an integer: allocation and iteration must agree,
// and a fractional length would throw in the typed-array constructor.
export function blackoutPayload(segmentCount: number): Uint8Array {
  return new Uint8Array(Math.max(0, Math.floor(segmentCount)) * 3);
}

// Linear-light channel scale (§49). Shared with renderer math.
function scaleChannel(v: number, intensity: number, gamma = 2.2): number {
  const lin = Math.pow(Math.min(255, Math.max(0, v)) / 255, gamma) * Math.min(1, Math.max(0, intensity));

  return Math.round(Math.pow(lin, 1 / gamma) * 255);
}

// Solid whole-fixture colour for the manual lane (set-color swatches):
// the same segmented frame the renderer emits, one colour for every zone.
export function solidPayload(segmentCount: number, r: number, g: number, b: number): Uint8Array {
  const count = Math.max(0, Math.floor(segmentCount));
  const out = new Uint8Array(count * 3);
  const clamp = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));

  for (let i = 0; i < count; i++) {
    out[i * 3] = clamp(r); out[i * 3 + 1] = clamp(g); out[i * 3 + 2] = clamp(b);
  }

  return out;
}

// One contiguous zone range in one colour for the console's segment paint;
// zones outside the range stay off. Indices clamp inside the frame so a
// stale range can never write out of bounds (§47 blackout safety).
export function paintRangePayload(segmentCount: number, from: number, to: number, r: number, g: number, b: number): Uint8Array {
  const count = Math.max(0, Math.floor(segmentCount));
  const out = new Uint8Array(count * 3);

  if (count === 0) return out;
  const lo = Math.max(0, Math.min(count - 1, Math.floor(Math.min(from, to))));
  const hi = Math.max(0, Math.min(count - 1, Math.floor(Math.max(from, to))));
  const clamp = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));

  for (let i = lo; i <= hi; i++) {
    out[i * 3] = clamp(r); out[i * 3 + 1] = clamp(g); out[i * 3 + 2] = clamp(b);
  }

  return out;
}

// White hits = RGB(255,255,255) scaled, never CCT mode (§48).
export function whiteHitPayload(segmentCount: number, intensity: number): Uint8Array {
  const count = Math.max(0, Math.floor(segmentCount));
  const out = new Uint8Array(count * 3);
  const w = scaleChannel(255, intensity);

  for (let i = 0; i < count; i++) { out[i * 3] = w; out[i * 3 + 1] = w; out[i * 3 + 2] = w; }

  return out;
}

// Latency offset in beats for per-fixture early send (§55).
export function latencyBeats(latencyMs: number, bpm: number): number {
  if (!(bpm > 0)) return 0;

  return (Math.max(0, latencyMs) / 1000) * (bpm / 60);
}

// Transport contract: Electron main owns UDP sockets; renderer owns desired
// state (§149). LAN first with read-back verify; BLE last-resort single-color;
// cloud REST never for frames (10/min/device ceiling).
interface SegmentStream {
  setAll(frame: Uint8Array): void;
  flush(): void;
  close(): void;
}

// Newest-state-wins stream: setAll coalesces, flush takes latest (§51).
// Transport owns delivery; show loop owns desired state (§149).
export class LatestStream implements SegmentStream {
  private coalescer = new FrameCoalescer();
  private closed = false;
  constructor(private readonly sender: (frame: Uint8Array) => void) {}
  setAll(frame: Uint8Array): void {
    if (this.closed) return;
    this.coalescer.push(frame);
  }
  flush(): void {
    if (this.closed) return;
    const f = this.coalescer.take();

    if (f) this.sender(f);
  }
  close(): void {
    this.closed = true;
    this.coalescer.take();
  }
}

// Pinned toolkit seam (§44-45): the vendored transport owns the SegmentStream
// behind this interface; LatestStream above is the no-hardware test double.
export interface ToolkitStreamFactory {
  openStream(deviceIp: string, zones: number): Promise<SegmentStream>;
}

// Single-zone fallback for the BLE/cloud last-resort path (T-GOV-10):
// averages every (equal-width) segment so a dark center cannot black out a
// lit frame; a symmetric frame collapses to its visual mean.
// Per-unit probe decides LAN colorwc versus segmented paint.
export function collapseToSingleColor(frame: Uint8Array): [number, number, number] {
  const n = Math.floor(frame.length / 3);

  if (n <= 0) return [0, 0, 0];
  let r = 0;
  let g = 0;
  let b = 0;

  for (let i = 0; i < n; i++) {
    r += frame[i * 3] ?? 0;
    g += frame[i * 3 + 1] ?? 0;
    b += frame[i * 3 + 2] ?? 0;
  }

  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

// LAN manager (§46, §106-107): discovery → arm → stream; per-device FPS
// backoff on congestion; reconnect re-arms and sends current frame only.
type DeviceHealth = "online" | "degraded" | "offline";

export interface ManagedDevice {
  identity: DeviceIdentity;
  health: DeviceHealth;
  fps: number;
  sentFrames: number;
  supersededFrames: number;
}

export class DeviceManager {
  private devices = new Map<string, ManagedDevice>();
  discover(identity: DeviceIdentity, fps: number): ManagedDevice {
    const existing = this.devices.get(identity.hardwareId);

    if (existing) {
      existing.identity = identity;
      existing.health = "online";
      existing.fps = fps;

      return existing;
    }

    const dev: ManagedDevice = { identity, health: "online", fps, sentFrames: 0, supersededFrames: 0 };
    this.devices.set(identity.hardwareId, dev);

    return dev;
  }
  markOffline(hardwareId: string): void {
    const dev = this.devices.get(hardwareId);

    if (dev) dev.health = "offline";
  }
  // Congestion: reduce only the affected device's FPS (§107); show stays 60Hz.
  backoff(hardwareId: string): void {
    const dev = this.devices.get(hardwareId);

    if (dev && dev.fps > 5) {
      dev.fps = Math.max(5, Math.floor(dev.fps / 2));
      dev.health = "degraded";
    }
  }
  recordSend(hardwareId: string, superseded: number): void {
    const dev = this.devices.get(hardwareId);

    if (dev) {
      dev.sentFrames += 1;
      dev.supersededFrames += superseded;
    }
  }
  get(hardwareId: string): ManagedDevice | undefined {
    return this.devices.get(hardwareId);
  }
}

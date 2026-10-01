// @autolight/govee: the transport-facing surface. The razer byte codec, the
// official LAN commands and the LanStreamEngine contract live in ./razer.ts
// and are re-exported here, so every existing import from "@autolight/govee"
// keeps resolving (T-GOV-01/02/03). Provenance: govee-toolkit MIT
// (Damien Thery, v0.5.0).
import { encodeRaw } from "./razer.js";

export {
  OPCODE, PORTS, encodeRaw, decodeRaw, envelope, arm, paint, paintZoned,
  parseStatus, MULTICAST, SCAN_REQUEST, parseScanReply,
  turnCommand, brightnessCommand, colorCommand, devStatusCommand, parseDevStatus,
  PacingStream, WALL_SCHEDULER,
} from "./razer.js";
export type {
  ScanReply, LanDeviceStatus, StreamTransport, Scheduler, TimerHandle,
  StreamOptions, EngineMetrics, EngineHealth, EngineStatus, EngineReport,
  LanStreamEngine, SegmentStreamLike,
} from "./razer.js";

// DS-02 engine switch (T-GOV-03): toolkit primary, native-ts fallback.
export { EngineSelector, createEngineSelector, ToolkitLoadFailure } from "./engines/index.js";
export type { EngineSummary, DeviceEngineDecision, EngineSelectorOptions } from "./engines/index.js";
export { ToolkitEngine, defaultToolkitLoader, isUnavailableError, ToolkitUnavailableError, unavailable, resolutionFor } from "./engines/toolkit.js";
export type { BindingModule, BindingDevice, BindingDeviceStatus, BindingStream, BindingSdk, BindingDeviceHandle, ToolkitLoader, ToolkitLoadResult, UnavailableReasonClass } from "./engines/toolkit.js";
export { NativeStreamEngine, SocketTransport, hasStatus, hasDiscover } from "./engines/native-ts.js";
export type { NativeEngineOptions, StatusCapable, DiscoverCapable } from "./engines/native-ts.js";

// Legacy alias kept until T-GOV-02 deletes encodeFrame (M1): maps to encodeRaw.
export function encodeFrame(opcode: number, payload: Uint8Array): Uint8Array {
  return encodeRaw(opcode, payload);
}

// Newest-state-wins: keep only latest pending frame (§51, §149).
export class FrameCoalescer {
  private pending: Uint8Array | null = null;
  push(frame: Uint8Array): void { this.pending = frame; }
  take(): Uint8Array | null { const f = this.pending; this.pending = null; return f; }
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

// Blackout = RGB 0,0,0, never power-off (§47).
export function blackoutPayload(segmentCount: number): Uint8Array {
  return new Uint8Array(Math.max(0, segmentCount) * 3);
}

// Linear-light channel scale (§49). Shared with renderer math.
export function scaleChannel(v: number, intensity: number, gamma = 2.2): number {
  const lin = Math.pow(Math.min(255, Math.max(0, v)) / 255, gamma) * Math.min(1, Math.max(0, intensity));
  return Math.round(Math.pow(lin, 1 / gamma) * 255);
}

// White hits = RGB(255,255,255) scaled, never CCT mode (§48).
export function whiteHitPayload(segmentCount: number, intensity: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, segmentCount) * 3);
  const w = scaleChannel(255, intensity);
  for (let i = 0; i < segmentCount; i++) { out[i * 3] = w; out[i * 3 + 1] = w; out[i * 3 + 2] = w; }
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
export type LanTransport = "lan" | "ble" | "cloud";

export interface SegmentStream {
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

// Single-zone fallback is owned by T-GOV-10: per-unit probe decides LAN
// colorwc versus segmented paint. No default claim until qualified.
export function collapseToSingleColor(frame: Uint8Array): [number, number, number] {
  const n = Math.floor(frame.length / 3);
  if (n <= 0) return [0, 0, 0];
  const mid = Math.floor(n / 2) * 3;
  return [frame[mid] ?? 0, frame[mid + 1] ?? 0, frame[mid + 2] ?? 0];
}

// LAN manager (§46, §106-107): discovery → arm → stream; per-device FPS
// backoff on congestion; reconnect re-arms and sends current frame only.
export type DeviceHealth = "online" | "degraded" | "offline";
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

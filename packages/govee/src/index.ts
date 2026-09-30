// LAN opcodes (§46); newest-state-wins coalescing (§51).
export const OPCODE = { ARM: 0xb1, RGB_STREAM: 0xb0, ZONED: 0xb4, ARM_STATUS: 0xb2 } as const;
export const PORTS = { DISCOVER_MCAST: 4001, DISCOVER_RESP: 4002, CONTROL: 4003 } as const;

// XOR checksum over length+opcode+payload (§46 frame family BB <len> <op> <payload> <xor>).
export function encodeFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const len = 1 + payload.length + 1;
  const out = new Uint8Array(2 + len);
  out[0] = 0xbb; out[1] = len; out[2] = opcode;
  out.set(payload, 3);
  let xor = 0;
  for (let i = 1; i < out.length - 1; i++) xor ^= out[i]!;
  out[out.length - 1] = xor;
  return out;
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

// Official Govee LAN API (wlan-guide): JSON over UDP — scan to multicast
// 239.255.255.250:4001, replies on 4002, unicast control to device IP:4003.
// Exactly 4 commands: turn, brightness, devStatus, colorwc. Whole-device
// color only — no scene/DreamView/segment commands, so beat-synced shows
// drive colorwc + brightness. Kelvin 0 = pure RGB; nonzero overrides RGB.
export const MULTICAST = "239.255.255.250";
export const SCAN_REQUEST = { msg: { cmd: "scan", data: { account_topic: "reserve" } } } as const;

export interface ScanReply {
  ip: string;
  device: string;
  sku: string;
  bleVersionHard: string;
  bleVersionSoft: string;
  wifiVersionHard: string;
  wifiVersionSoft: string;
}

export function parseScanReply(raw: unknown): ScanReply | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = (raw as { msg?: { cmd?: unknown; data?: unknown } }).msg?.data as Record<string, unknown> | undefined;
  if (!data || typeof data["ip"] !== "string" || typeof data["device"] !== "string" || typeof data["sku"] !== "string") return null;
  return {
    ip: data["ip"] as string,
    device: data["device"] as string,
    sku: data["sku"] as string,
    bleVersionHard: typeof data["bleVersionHard"] === "string" ? data["bleVersionHard"] as string : "",
    bleVersionSoft: typeof data["bleVersionSoft"] === "string" ? data["bleVersionSoft"] as string : "",
    wifiVersionHard: typeof data["wifiVersionHard"] === "string" ? data["wifiVersionHard"] as string : "",
    wifiVersionSoft: typeof data["wifiVersionSoft"] === "string" ? data["wifiVersionSoft"] as string : "",
  };
}

export function turnCommand(on: boolean): string {
  return JSON.stringify({ msg: { cmd: "turn", data: { value: on ? 1 : 0 } } });
}

export function brightnessCommand(value: number): string {
  const v = Math.min(100, Math.max(1, Math.round(value)));
  return JSON.stringify({ msg: { cmd: "brightness", data: { value: v } } });
}

export function colorCommand(r: number, g: number, b: number): string {
  const clamp = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));
  return JSON.stringify({ msg: { cmd: "colorwc", data: { color: { r: clamp(r), g: clamp(g), b: clamp(b) }, colorTemInKelvin: 0 } } });
}

export function devStatusCommand(): string {
  return JSON.stringify({ msg: { cmd: "devStatus", data: {} } });
}

export interface LanDeviceStatus {
  onOff: boolean;
  brightness: number;
  color: { r: number; g: number; b: number };
  colorTemInKelvin: number;
}

export function parseDevStatus(raw: unknown): LanDeviceStatus | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = (raw as { msg?: { cmd?: unknown; data?: unknown } }).msg?.data as Record<string, unknown> | undefined;
  if (!data || typeof data["onOff"] !== "number" || typeof data["brightness"] !== "number") return null;
  const color = data["color"] as { r?: unknown; g?: unknown; b?: unknown } | undefined;
  return {
    onOff: (data["onOff"] as number) === 1,
    brightness: data["brightness"] as number,
    color: {
      r: typeof color?.r === "number" ? color.r as number : 0,
      g: typeof color?.g === "number" ? color.g as number : 0,
      b: typeof color?.b === "number" ? color.b as number : 0,
    },
    colorTemInKelvin: typeof data["colorTemInKelvin"] === "number" ? data["colorTemInKelvin"] as number : 0,
  };
}

// Transport contract: Electron main owns UDP sockets; renderer owns desired
// state (§149). LAN first with read-back verify; BLE last-resort single-color
// (Lightwave order); cloud REST never for frames (10/min/device ceiling).
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

// H6076 is single-zone over LAN (community-confirmed): gradient paints
// collapse to the middle color on Wi-Fi; segments/scenes stay cloud-only.
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

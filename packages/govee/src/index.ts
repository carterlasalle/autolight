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

export interface SegmentStream {
  setAll(frame: Uint8Array): void;
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
    const f = this.coalescer.take();
    if (f) this.sender(f);
  }
  close(): void { this.closed = true; }
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

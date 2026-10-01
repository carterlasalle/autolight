// Razer segment stream and the official LAN commands (WP03, toolkit lan.md
// 2.1-2.3 and the wlan-guide). Provenance: govee-toolkit MIT (Damien Thery,
// v0.5.0, commit ceef296f6382881c5f07698d78fb5719ebca6686, package
// `govee-toolkit` 0.5.0): envelope UDP JSON to device:4003
// {"msg":{"cmd":"razer","data":{"pt":"<base64>"}}}; raw frame
// BB <len_hi> <len_lo> <opcode> <payload> <xor>, len is the payload length
// only (16-bit big endian), xor covers every preceding byte including BB.
// Arm golden vector: bb 00 01 b1 01 0a.
//
// This module is the seam both engines share (T-GOV-01, T-GOV-02): the byte
// codec, the official LAN commands, the LanStreamEngine contract, the pacing
// loop and the scheduler. `packages/govee/src/index.ts` re-exports all of it,
// so existing imports from "@autolight/govee" keep resolving. It imports
// nothing from the engine modules, so the engines can import it without a
// cycle.

export const OPCODE = { ARM: 0xb1, RGB_STREAM: 0xb0, ZONED: 0xb4, ARM_STATUS: 0xb2 } as const;
export const PORTS = { DISCOVER_MCAST: 4001, DISCOVER_RESP: 4002, CONTROL: 4003 } as const;

export function encodeRaw(opcode: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + 2 + 1 + payload.length + 1);
  out[0] = 0xbb;
  out[1] = (payload.length >> 8) & 0xff;
  out[2] = payload.length & 0xff;
  out[3] = opcode;
  out.set(payload, 4);
  let xor = 0;
  for (let i = 0; i < out.length - 1; i++) xor ^= out[i]!;
  out[out.length - 1] = xor & 0xff;
  return out;
}

export function decodeRaw(frame: Uint8Array): { opcode: number; payload: Uint8Array } | null {
  if (frame.length < 5) return null;
  if (frame[0] !== 0xbb) return null;
  const len = (((frame[1] ?? 0) << 8) | (frame[2] ?? 0)) & 0xffff;
  if (frame.length !== 5 + len) return null;
  let xor = 0;
  for (let i = 0; i < frame.length - 1; i++) xor ^= frame[i]!;
  if ((frame[frame.length - 1] ?? -1) !== (xor & 0xff)) return null;
  return { opcode: frame[3]!, payload: frame.slice(4, 4 + len) };
}

export function envelope(raw: Uint8Array): string {
  const b64 = Buffer.from(raw).toString("base64");
  return JSON.stringify({ msg: { cmd: "razer", data: { pt: b64 } } });
}

export function arm(on: boolean): Uint8Array {
  return encodeRaw(OPCODE.ARM, new Uint8Array([on ? 1 : 0]));
}

export function paint(colors: Uint8Array, gradient = 0): Uint8Array {
  if (colors.length % 3 !== 0) throw new RangeError(`paint needs 3 bytes per zone, got ${colors.length}`);
  const n = colors.length / 3;
  if (n > 255) throw new RangeError(`B0 nbSeg is one byte, got ${n} zones`);
  const payload = new Uint8Array(2 + colors.length);
  payload[0] = gradient;
  payload[1] = n;
  payload.set(colors, 2);
  return encodeRaw(OPCODE.RGB_STREAM, payload);
}

export function paintZoned(entries: { r: number; g: number; b: number; zone: number }[], gradient = 0): Uint8Array {
  if (entries.length > 255) throw new RangeError(`B4 nbSeg is one byte, got ${entries.length} entries`);
  const payload = new Uint8Array(2 + entries.length * 4);
  payload[0] = gradient;
  payload[1] = entries.length;
  entries.forEach((e, i) => {
    payload[2 + i * 4] = e.r;
    payload[2 + i * 4 + 1] = e.g;
    payload[2 + i * 4 + 2] = e.b;
    payload[2 + i * 4 + 3] = e.zone;
  });
  return encodeRaw(OPCODE.ZONED, payload);
}

export function parseStatus(raw: unknown): { onOff: boolean; brightness: number; armed: boolean } | null {
  if (typeof raw !== "object" || raw === null) return null;
  if (!("msg" in raw) || typeof raw.msg !== "object" || raw.msg === null) return null;
  const msg = raw.msg as { cmd?: unknown; data?: unknown };
  if (msg.cmd !== "status" || typeof msg.data !== "object" || msg.data === null) return null;
  const data = msg.data as { onOff?: unknown; brightness?: unknown; pt?: unknown };
  let armed = false;
  if (typeof data.pt === "string" && data.pt.length > 0) {
    let bytes: Uint8Array | null = null;
    try {
      bytes = new Uint8Array(Buffer.from(data.pt, "base64"));
    } catch {
      bytes = null;
    }
    const decoded = bytes ? decodeRaw(bytes) : null;
    if (decoded !== null && decoded.opcode === OPCODE.ARM_STATUS && decoded.payload.length >= 1) {
      armed = decoded.payload[0] === 1;
    }
  }
  return {
    onOff: data.onOff === 1,
    brightness: typeof data.brightness === "number" ? data.brightness : 0,
    armed,
  };
}

// Official Govee LAN API (wlan-guide): JSON over UDP, scan to multicast
// 239.255.255.250:4001, replies on 4002, unicast control to device IP:4003.
// Exactly 4 commands: turn, brightness, devStatus, colorwc. Whole-device
// color only, so a beat-synced show drives the razer stream and uses these
// for power, level and read-back. Kelvin 0 = pure RGB.
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

// ---------------------------------------------------------------------------
// Engine contract (DS-02). Both engines write through a StreamTransport, so
// the datagram bytes live in one place (T-GOV-03 parity).
// ---------------------------------------------------------------------------

export interface StreamTransport {
  // One razer frame on the wire, envelope included.
  sendRaw(deviceId: string, raw: Uint8Array): void;
  // One official JSON command (turn, brightness, devStatus, colorwc).
  sendJson(deviceId: string, text: string): void;
}

// Opaque timer handle owned by the scheduler implementation.
export type TimerHandle = unknown;

export interface Scheduler {
  now(): number;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

const wallNow = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

// `fn`: no callback arguments are supplied (setTimeout/setInterval pass none),
// so the wrappers hand nothing to the paced loop.
export const WALL_SCHEDULER: Scheduler = {
  now: wallNow,
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (handle) => { globalThis.clearInterval(handle as number); },
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => { globalThis.clearTimeout(handle as number); },
};

export interface StreamOptions {
  // Qualified segment count, or null to let the engine pick its resolution.
  resolution: number | null;
  rateHz: number;
  gradient: number;
  armSettleMs: number;
  // Arm the channel when the stream opens (default true): the toolkit binding
  // arms inside openStream, so the native loop does the same for parity. The
  // disarm on close is written whenever this stream armed.
  arm?: boolean;
}

export interface EngineMetrics {
  engine: string;
  framesRequested: number;
  framesSent: number;
  framesSuperseded: number;
  missedTicks: number;
  effectiveHz: number;
}

export interface EngineHealth {
  state: string;
  failures: number;
  available: boolean;
}

export interface EngineStatus {
  onOff: boolean;
  brightness: number;
  armed: boolean;
}

export interface EngineReport {
  kind: "toolkit" | "native-ts";
  available: boolean;
  reason?: string;
}

export interface LanStreamEngine {
  // Protocol fact (§44): the addon is context-aware and can fail to load.
  // Unavailable is a typed state, never a silent fallback.
  report(): EngineReport;
  discover(): Promise<string[]>;
  status(deviceId: string): Promise<EngineStatus | null>;
  openStream(deviceId: string, opts: StreamOptions): Promise<SegmentStreamLike>;
  close(): Promise<void>;
  identify(deviceId: string): Promise<void>;
  // Non-stream paint, no channel open (T-GOV-12 identify flash, setup passes).
  segment(deviceId: string, frame: Uint8Array): Promise<void>;
  health(deviceId: string): Promise<EngineHealth | null>;
  metrics(deviceId?: string): EngineMetrics[];
}

// Structural twin of index.ts SegmentStream, kept here so razer.ts imports
// nothing from index.ts.
export interface SegmentStreamLike {
  setAll(frame: Uint8Array): void;
  close(): void;
}

// DS-02 engine kinds and the typed reasons the switch records (T-GOV-03).
export type EngineKind = "toolkit" | "native-ts";
export type EngineMode = EngineKind | "auto";
export type UnavailableReason = "load" | "context" | "platform" | "error-class";

const REASON_LABELS: Record<UnavailableReason, string> = {
  load: "toolkit addon failed to load",
  context: "toolkit addon unavailable in this context",
  platform: "toolkit addon has no artifact for this platform",
  "error-class": "toolkit stream error",
};

// "native engine (reason)" as the device tile shows it (DS-02).
export function reasonText(reasonClass: UnavailableReason, detail: string): string {
  return `${REASON_LABELS[reasonClass]}: ${detail}`;
}

// Pacing loop: fixed interval emitter, unchanged frames are not re-sent,
// missed ticks are skipped and never burst, superseded frames counted, and a
// disarm is written on close (T-GOV-02, T-GOV-08 §51/§106/§107/§149).
export class PacingStream implements SegmentStreamLike {
  readonly zones: number;
  readonly rateHz: number;
  framesRequested = 0;
  framesSent = 0;
  framesSuperseded = 0;
  missedTicks = 0;
  private readonly deviceId: string;
  private readonly opts: StreamOptions;
  private readonly transport: StreamTransport;
  private readonly clock: Scheduler;
  private readonly intervalMs: number;
  private latest: Uint8Array | null = null;
  private current: Uint8Array | null = null;
  private lastSentHex: string | null = null;
  private started = false;
  private armed = false;
  private closed = false;
  private lastAt: number;
  private startTimer: TimerHandle | null = null;
  private interval: TimerHandle | null = null;

  constructor(
    deviceId: string,
    opts: StreamOptions,
    transport: StreamTransport,
    clock: Scheduler = WALL_SCHEDULER,
  ) {
    this.deviceId = deviceId;
    this.opts = opts;
    this.transport = transport;
    this.clock = clock;
    this.zones = Math.max(0, opts.resolution ?? 0);
    this.rateHz = opts.rateHz;
    this.intervalMs = Math.max(1, Math.round(1000 / Math.max(1, opts.rateHz)));
    this.lastAt = clock.now();
    if (opts.arm !== false) {
      // Arm first, then the settle timer runs before the first paint: a paint
      // right after arming is lost (toolkit lan.md, sequence).
      this.armed = true;
      transport.sendRaw(deviceId, arm(true));
    }
    this.startTimer = clock.setTimeout(() => { this.startStream(); }, Math.max(0, opts.armSettleMs));
  }

  // Arm settles for the caller's measured window before the first paint: a
  // paint right after arming is lost (toolkit lan.md, sequence).
  private startStream(): void {
    if (this.closed) return;
    this.started = true;
    this.interval = this.clock.setInterval(() => { this.emit(); }, this.intervalMs);
    if (this.latest !== null) this.emit();
  }

  private emit(): void {
    const now = this.clock.now();
    const behind = Math.floor((now - this.lastAt) / this.intervalMs) - 1;
    if (behind > 0) this.missedTicks += behind;
    this.lastAt = now;
    if (this.latest === null) return;
    const frame = this.latest;
    this.latest = null;
    const hex = Buffer.from(frame).toString("hex");
    if (hex === this.lastSentHex) return;
    this.lastSentHex = hex;
    this.framesSent += 1;
    this.transport.sendRaw(this.deviceId, paint(frame, this.opts.gradient));
  }

  setAll(frame: Uint8Array): void {
    if (this.closed) return;
    if (this.opts.resolution !== null && frame.length !== this.zones * 3) {
      throw new RangeError(`frame needs ${this.zones * 3} bytes for ${this.zones} zones, got ${frame.length}`);
    }
    this.framesRequested += 1;
    if (this.latest !== null) this.framesSuperseded += 1;
    // Copied into the engine's own buffer: no shared mutable buffers (§51).
    this.latest = frame.slice();
    this.current = this.latest;
  }

  // The newest accepted frame, for identify restore (T-GOV-12).
  get currentFrame(): Uint8Array | null {
    return this.current;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.latest = null;
    if (this.startTimer !== null) { this.clock.clearTimeout(this.startTimer); this.startTimer = null; }
    if (this.interval !== null) { this.clock.clearInterval(this.interval); this.interval = null; }
    // Disarm on close: the channel ends and the unit returns to its own colour
    // (toolkit lan.md, disarm). No handle can flush afterwards (§106, F-GOV-14).
    if (this.armed) this.transport.sendRaw(this.deviceId, arm(false));
  }
}

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
//
// Snap versus fade (hardware receipt 2026-10-12, owner H6076 + H1A45): the
// firmware eases `colorwc` frames into each other, so rapid colorwc strobes
// read as a slow gradient, not a snap. B0/B4 paint with gradient=0 snaps
// with no fade at 10 Hz on both units. Rule: anything that must cut —
// strobes, white hits, blackouts — travels the razer stream, never colorwc.
// colorwc is for slow fades and static looks, where the easing is welcome.

import { z } from "zod";

export const OPCODE = { ARM: 0xb1, RGB_STREAM: 0xb0, ZONED: 0xb4, ARM_STATUS: 0xb2 } as const;

export const PORTS = { DISCOVER_MCAST: 4001, DISCOVER_RESP: 4002, CONTROL: 4003 } as const;

/**
 * JSON value exactly as a LAN datagram delivers it. Every reply parser below
 * validates this against a message schema before touching a field — this is
 * the raw side of the UDP boundary.
 */
export type LanInbound = string | number | boolean | null | LanInbound[] | { [key: string]: LanInbound };

export function encodeRaw(opcode: number, payload: Uint8Array): Uint8Array {
  if (payload.length > 0xffff) throw new RangeError(`payload length exceeds 16 bits, got ${payload.length}`);
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

/** One protocol byte with a loud bound: Uint8Array silently wraps an
 *  out-of-range value into a different request than the caller intended. */
function byteChecked(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`${name} needs an integer 0 to 255, got ${value}`);
  }

  return value;
}

export function paint(colors: Uint8Array, gradient = 0): Uint8Array {
  if (colors.length % 3 !== 0) throw new RangeError(`paint needs 3 bytes per zone, got ${colors.length}`);
  const n = colors.length / 3;

  if (n > 255) throw new RangeError(`B0 nbSeg is one byte, got ${n} zones`);
  const payload = new Uint8Array(2 + colors.length);
  payload[0] = byteChecked("gradient", gradient);
  payload[1] = n;
  payload.set(colors, 2);

  return encodeRaw(OPCODE.RGB_STREAM, payload);
}

export function paintZoned(entries: { r: number; g: number; b: number; zone: number }[], gradient = 0): Uint8Array {
  if (entries.length > 255) throw new RangeError(`B4 nbSeg is one byte, got ${entries.length} entries`);
  const payload = new Uint8Array(2 + entries.length * 4);
  payload[0] = byteChecked("gradient", gradient);
  payload[1] = entries.length;
  entries.forEach((e, i) => {
    payload[2 + i * 4] = byteChecked(`entry ${i} r`, e.r);
    payload[2 + i * 4 + 1] = byteChecked(`entry ${i} g`, e.g);
    payload[2 + i * 4 + 2] = byteChecked(`entry ${i} b`, e.b);
    payload[2 + i * 4 + 3] = byteChecked(`entry ${i} zone`, e.zone);
  });

  return encodeRaw(OPCODE.ZONED, payload);
}

const statusMessageSchema = z.object({
  msg: z.object({
    cmd: z.literal("status"),
    data: z.object({
      onOff: z.number().optional(),
      brightness: z.number().optional(),
      pt: z.string().optional(),
    }),
  }),
});

export function parseStatus(raw: LanInbound): { onOff: boolean; brightness: number; armed: boolean } | null {
  const parsed = statusMessageSchema.safeParse(raw);

  if (!parsed.success) return null;
  const data = parsed.data.msg.data;
  let armed = false;

  if (data.pt !== undefined && data.pt.length > 0) {
    // Buffer.from(…, "base64") never throws: it silently drops invalid
    // characters, so malformed pt would decode to garbage bytes. Validate
    // with a padding-insensitive re-encode round trip instead of the dead
    // try/catch that never fired.
    const decodedBytes = Buffer.from(data.pt, "base64");
    const canonical = decodedBytes.toString("base64").replace(/=+$/, "");
    const bytes = canonical === data.pt.replace(/=+$/, "") ? new Uint8Array(decodedBytes) : null;

    const decoded = bytes ? decodeRaw(bytes) : null;

    if (decoded !== null && decoded.opcode === OPCODE.ARM_STATUS && decoded.payload.length >= 1) {
      armed = decoded.payload[0] === 1;
    }
  }

  return {
    onOff: data.onOff === 1,
    brightness: data.brightness ?? 0,
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

const scanReplySchema = z.object({
  msg: z.object({
    data: z.object({
      ip: z.string(),
      device: z.string(),
      sku: z.string(),
      bleVersionHard: z.string().optional(),
      bleVersionSoft: z.string().optional(),
      wifiVersionHard: z.string().optional(),
      wifiVersionSoft: z.string().optional(),
    }),
  }),
});

export function parseScanReply(raw: LanInbound): ScanReply | null {
  const parsed = scanReplySchema.safeParse(raw);

  if (!parsed.success) return null;
  const data = parsed.data.msg.data;

  return {
    ip: data.ip,
    device: data.device,
    sku: data.sku,
    bleVersionHard: data.bleVersionHard ?? "",
    bleVersionSoft: data.bleVersionSoft ?? "",
    wifiVersionHard: data.wifiVersionHard ?? "",
    wifiVersionSoft: data.wifiVersionSoft ?? "",
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

const devStatusSchema = z.object({
  msg: z.object({
    data: z.object({
      onOff: z.number(),
      brightness: z.number(),
      color: z
        .object({
          r: z.number().optional(),
          g: z.number().optional(),
          b: z.number().optional(),
        })
        .optional(),
      colorTemInKelvin: z.number().optional(),
    }),
  }),
});

export function parseDevStatus(raw: LanInbound): LanDeviceStatus | null {
  const parsed = devStatusSchema.safeParse(raw);

  if (!parsed.success) return null;
  const data = parsed.data.msg.data;

  return {
    onOff: data.onOff === 1,
    brightness: data.brightness,
    color: {
      r: data.color?.r ?? 0,
      g: data.color?.g ?? 0,
      b: data.color?.b ?? 0,
    },
    colorTemInKelvin: data.colorTemInKelvin ?? 0,
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
  // Optional send-side error source: a transport that owns its sockets can
  // expose the last error per device so engines report it instead of a
  // fabricated "ok" (native-ts T-GOV-04 health()).
  errorFor?(deviceId: string): Error | null;
}

// Timer handle minted by a scheduler: Node and Electron mint Timeout objects,
// browsers and deterministic fakes mint numeric ids. Callers never inspect it —
// they store it and hand it back to the same scheduler.
export type TimerHandle = number | ReturnType<typeof globalThis.setInterval>;

export interface Scheduler {
  now(): number;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

const wallNow = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

// `fn`: no callback arguments are supplied (setTimeout/setInterval pass none),
// so the wrappers hand nothing to the paced loop.
export const WALL_SCHEDULER: Scheduler = {
  now: wallNow,
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (handle) => { globalThis.clearInterval(handle); },
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => { globalThis.clearTimeout(handle); },
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
  private armed = false;
  private closed = false;
  private lastAt: number;
  private readonly startedAt: number;
  private startTimer: TimerHandle | null = null;
  private interval: TimerHandle | null = null;

  /** Measured average send rate since creation; 0 until the first frame
   *  lands. The honest counterpart of the requested `rateHz`. */
  get effectiveHz(): number {
    const seconds = (this.clock.now() - this.startedAt) / 1000;

    return seconds > 0 && this.framesSent > 0 ? this.framesSent / seconds : 0;
  }

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
    this.startedAt = clock.now();

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
    // The cadence clock starts with the stream, not construction: counting
    // the arm-settle wait as elapsed intervals inflated missedTicks.
    this.lastAt = this.clock.now();
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

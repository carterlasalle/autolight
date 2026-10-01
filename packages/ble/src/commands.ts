// BLE frame codec and command set (T-BLE-04; WP04 BLE protocol facts).
//
// Sources: WP04 which cites govee-toolkit docs/protocol/ble.md (all 9
// sections), devices/H61A0.yaml (measurements.ble), devices/H6008.yaml
// (render_hold_ms), packages/rust/src/ble, and govee-homeassistant
// custom_components/govee/api ble files (segmented versus single zone,
// SEGMENTED_MODELS allowlist, protocol v2 AES-GCM session). No claim here
// measures the owner's units; sim runs prove code, never hardware.
//
// Frame layout for 0x33, 0xAA, 0xA1, 0xA3 (WP04): 20 bytes,
// [proType, cmd, 17 payload bytes padded with zeros, XOR of bytes 0 to 18].
// Host colour 0xA5 frames are short: [0xA5, sub, payload, sum of prior bytes].
// Write acks arrive on notify as [0x33, cmd, status] where 0x00 means the
// device accepted the write, not that it applied it. Callers read back to
// verify.
import {
  BLE_A5_MIN_LEN,
  BLE_FRAME_LEN,
  BLE_MASKED_KIND,
  BLE_PAYLOAD_LEN,
  BLE_PROTYPE,
} from "./constants.js";

export interface BleFrame {
  proType: number;
  cmd: number;
  /** Raw payload bytes without padding or checksum. */
  payload: Uint8Array;
}

function xorOf(bytes: Uint8Array, end: number): number {
  let xor = 0;
  for (let i = 0; i < end; i++) xor ^= bytes[i] ?? 0;
  return xor & 0xff;
}

function sumOf(bytes: Uint8Array): number {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  return sum;
}

/** Encodes a 20 byte frame for 0x33, 0xAA, 0xA1, 0xA3. Payload over 17 bytes throws. */
export function encodeBleFrame(proType: number, cmd: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  if (proType === BLE_PROTYPE.HOST_COLOR) {
    throw new RangeError("use encodeHostColor for 0xA5 frames");
  }
  if (payload.length > BLE_PAYLOAD_LEN) {
    throw new RangeError(`BLE payload needs at most ${BLE_PAYLOAD_LEN} bytes, got ${payload.length}`);
  }
  const out = new Uint8Array(BLE_FRAME_LEN);
  out[0] = proType & 0xff;
  out[1] = cmd & 0xff;
  out.set(payload, 2);
  out[BLE_FRAME_LEN - 1] = xorOf(out, BLE_FRAME_LEN - 1);
  return out;
}

/** Decodes a 20 byte frame. Returns null on length, marker or checksum mismatch. */
export function decodeBleFrame(frame: Uint8Array): BleFrame | null {
  if (frame.length !== BLE_FRAME_LEN) return null;
  const proType = frame[0] ?? -1;
  if (
    proType !== BLE_PROTYPE.WRITE &&
    proType !== BLE_PROTYPE.READ &&
    proType !== BLE_PROTYPE.PROVISION &&
    proType !== BLE_PROTYPE.CHUNKED
  ) {
    return null;
  }
  if ((frame[BLE_FRAME_LEN - 1] ?? -1) !== xorOf(frame, BLE_FRAME_LEN - 1)) return null;
  const cmd = frame[1] ?? 0;
  return { proType, cmd, payload: frame.slice(2, 2 + BLE_PAYLOAD_LEN) };
}

/** Encodes a short 0xA5 host colour frame with a sum checksum. */
export function encodeHostColor(sub: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(2 + payload.length + 1);
  out[0] = BLE_PROTYPE.HOST_COLOR;
  out[1] = sub & 0xff;
  out.set(payload, 2);
  out[out.length - 1] = sumOf(out.subarray(0, out.length - 1));
  return out;
}

/** Decodes a short 0xA5 frame. Returns null on marker or sum mismatch. */
export function decodeHostColor(frame: Uint8Array): { sub: number; payload: Uint8Array } | null {
  if (frame.length < BLE_A5_MIN_LEN) return null;
  if ((frame[0] ?? -1) !== BLE_PROTYPE.HOST_COLOR) return null;
  if ((frame[frame.length - 1] ?? -1) !== sumOf(frame.subarray(0, frame.length - 1))) return null;
  return { sub: frame[1] ?? 0, payload: frame.slice(2, frame.length - 1) };
}

/** Independent hex helper for tests: never used to compute expectations. */
export function bleHex(frame: Uint8Array): string {
  return Buffer.from(frame).toString("hex");
}

export interface BleAck {
  cmd: number;
  status: number;
  /** True when status is 0x00: accepted, not applied. Read back to verify. */
  accepted: boolean;
}

/** Parses a notify ack of the form [0x33, cmd, status]. Null on any other shape. */
export function parseBleAck(notify: Uint8Array): BleAck | null {
  if (notify.length < 3) return null;
  if ((notify[0] ?? -1) !== BLE_PROTYPE.WRITE) return null;
  const cmd = notify[1] ?? 0;
  const status = notify[2] ?? 0;
  return { cmd, status, accepted: status === 0x00 };
}

// ---------------------------------------------------------------------------
// Command builders (WP04 command list)
// ---------------------------------------------------------------------------

/** Power write: 33 01 <0|1>. */
export function blePower(on: boolean): Uint8Array {
  return encodeBleFrame(BLE_PROTYPE.WRITE, 0x01, new Uint8Array([on ? 1 : 0]));
}

export type BleBrightnessScale = 100 | 255;

/** Brightness write: 33 04 <level>. Scale comes from the device profile. */
export function bleBrightness(level01: number, scale: BleBrightnessScale = 100): Uint8Array {
  const clamped01 = Math.min(1, Math.max(0, level01));
  const level = scale === 100
    ? Math.min(100, Math.max(0, Math.round(clamped01 * 100)))
    : Math.min(255, Math.max(0, Math.round(clamped01 * 255)));
  return encodeBleFrame(BLE_PROTYPE.WRITE, 0x04, new Uint8Array([level]));
}

export interface BleRgb {
  r: number;
  g: number;
  b: number;
}

function byte(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

/** Single colour: 33 05 0d <RGB> <K_hi K_lo> <RGB white>. Kelvin 0 for RGB. */
export function bleColorSingle(color: BleRgb, kelvin = 0, white: BleRgb = { r: 0, g: 0, b: 0 }): Uint8Array {
  const payload = new Uint8Array([
    0x0d,
    byte(color.r), byte(color.g), byte(color.b),
    (kelvin >> 8) & 0xff, kelvin & 0xff,
    byte(white.r), byte(white.g), byte(white.b),
  ]);
  return encodeBleFrame(BLE_PROTYPE.WRITE, 0x05, payload);
}

/** Legacy colour: 33 05 02 <tail>. Tail carries the family specific bytes. */
export function bleColorLegacy(tail: Uint8Array): Uint8Array {
  const payload = new Uint8Array(1 + tail.length);
  payload[0] = 0x02;
  payload.set(tail, 1);
  return encodeBleFrame(BLE_PROTYPE.WRITE, 0x05, payload);
}

/** Mask layout: LSB first, ceil(zoneCount / 8) bytes. Bit i set means zone i takes part. */
export function maskForZones(zones: readonly number[], zoneCount: number): Uint8Array {
  const len = Math.ceil(Math.max(0, zoneCount) / 8);
  const out = new Uint8Array(len);
  for (const z of zones) {
    if (z < 0 || z >= zoneCount) throw new RangeError(`zone ${z} outside 0 to ${zoneCount - 1}`);
    out[Math.floor(z / 8)]! |= 1 << (z % 8);
  }
  return out;
}

/** Masked colour: 33 05 15 01 <RGB> <K> <RGBw> <mask>. */
export function bleColorMasked(
  color: BleRgb,
  zones: readonly number[],
  zoneCount: number,
  kelvin = 0,
  white: BleRgb = { r: 0, g: 0, b: 0 },
): Uint8Array {
  const mask = maskForZones(zones, zoneCount);
  const payload = new Uint8Array(2 + 3 + 1 + 3 + mask.length);
  payload[0] = 0x15;
  payload[1] = BLE_MASKED_KIND.COLOR;
  payload[2] = byte(color.r);
  payload[3] = byte(color.g);
  payload[4] = byte(color.b);
  payload[5] = byte(kelvin);
  payload[6] = byte(white.r);
  payload[7] = byte(white.g);
  payload[8] = byte(white.b);
  payload.set(mask, 9);
  return encodeBleFrame(BLE_PROTYPE.WRITE, 0x05, payload);
}

/** Masked brightness: 33 05 15 02 <level> <mask>. Level uses the family scale. */
export function bleMaskedBrightness(
  level01: number,
  zones: readonly number[],
  zoneCount: number,
  scale: BleBrightnessScale = 100,
): Uint8Array {
  const level = scale === 100
    ? Math.min(100, Math.max(0, Math.round(Math.min(1, Math.max(0, level01)) * 100)))
    : Math.min(255, Math.max(0, Math.round(Math.min(1, Math.max(0, level01)) * 255)));
  const mask = maskForZones(zones, zoneCount);
  const payload = new Uint8Array(3 + mask.length);
  payload[0] = 0x15;
  payload[1] = BLE_MASKED_KIND.BRIGHTNESS;
  payload[2] = level;
  payload.set(mask, 3);
  return encodeBleFrame(BLE_PROTYPE.WRITE, 0x05, payload);
}

/** Per zone brightness: 33 05 15 03 <levels>. One byte per zone in index order. */
export function blePerZoneBrightness(levels01: readonly number[], scale: BleBrightnessScale = 100): Uint8Array {
  const payload = new Uint8Array(2 + levels01.length);
  payload[0] = 0x15;
  payload[1] = BLE_MASKED_KIND.PER_ZONE_BRIGHTNESS;
  levels01.forEach((v, i) => {
    const c = Math.min(1, Math.max(0, v));
    payload[2 + i] = scale === 100 ? Math.min(100, Math.max(0, Math.round(c * 100))) : Math.min(255, Math.max(0, Math.round(c * 255)));
  });
  return encodeBleFrame(BLE_PROTYPE.WRITE, 0x05, payload);
}

/** Zone interpolation: 33 a3 <0|1>. */
export function bleInterpolation(on: boolean): Uint8Array {
  return encodeBleFrame(BLE_PROTYPE.WRITE, 0xa3, new Uint8Array([on ? 1 : 0]));
}

/** Generic read: AA <cmd> <extra>. Covers aa 01, 04, 0f, 40, 05, 14, 20, 21, 06, ab and aa 07 03, aa a5 <group>. */
export function bleRead(cmd: number, extra: Uint8Array = new Uint8Array(0)): Uint8Array {
  return encodeBleFrame(BLE_PROTYPE.READ, cmd, extra);
}

export const BLE_READS = {
  POWER: 0x01,
  BRIGHTNESS: 0x04,
  SUB_MODE: 0x05,
  EXTRA_06: 0x06,
  SEGMENT_COUNT: 0x0f,
  WIFI_MAC: 0x14,
  HARD_VERSION: 0x20,
  SOFT_VERSION: 0x21,
  IC_COUNT: 0x40,
  GROUP_A5: 0xa5,
  EXTRA_AB: 0xab,
} as const;

/** Host colour probe: a5 02 90. Render is temporary; lights a unit whose stored state is off. */
export function bleHostColorProbe(): Uint8Array {
  return encodeHostColor(0x02, new Uint8Array([0x90]));
}

/** Host colour one colour: a5 02 83 <RGB>. Scaled by stored brightness, reports nothing. */
export function bleHostColorOne(color: BleRgb): Uint8Array {
  return encodeHostColor(0x02, new Uint8Array([0x83, byte(color.r), byte(color.g), byte(color.b)]));
}

// ---------------------------------------------------------------------------
// Dialect record (T-BLE-04: recorded per device in its profile)
// ---------------------------------------------------------------------------

export type BleColorMode = "single-0d" | "masked-15-01" | "legacy-02";

export interface BleDialect {
  brightnessScale: BleBrightnessScale;
  colorModes: BleColorMode[];
  supportsMaskedBrightness: boolean;
  supportsPerZoneBrightness: boolean;
  supportsInterpolation: boolean;
  supportsHostColor: boolean;
}

export function defaultBleDialect(): BleDialect {
  return {
    brightnessScale: 100,
    colorModes: ["single-0d"],
    supportsMaskedBrightness: false,
    supportsPerZoneBrightness: false,
    supportsInterpolation: false,
    supportsHostColor: true,
  };
}

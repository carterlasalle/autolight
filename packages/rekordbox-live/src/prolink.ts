// PRO DJ LINK packet decode (T-LIVE-05, Deep Symmetry dysentery layout).
//
// 10-byte magic header on every packet: "Qspt1WmJOL" at offset 0 plus the
// device name at offset 10. Beat packets (port 50001) are 0x60 = 96 bytes,
// with the next-beat interval in 1/100 ms at offset 0x24, the second-beat
// interval at 0x28, pitch at 0x38 (0x100000 is 0 percent), BPM x 100 at 0x5a,
// beat within bar at 0x5c, and the track device at 0x5e. Status packets
// (port 50002) carry play state at 0x6f, master and sync flags at 0x75,
// track ID at 0x2c, source slot at 0x28, pitch at 0x8c. Keepalives (port
// 50000) are 0x36 bytes and only announce presence. Offsets are from the
// published protocol documentation; no EPL code is copied.
//
// Validation is strict and counted: wrong magic, wrong length for the packet
// type, or an unknown type is rejected and never reaches the providers.

export const PROLINK_MAGIC = "Qspt1WmJOL";
export const PROLINK_BEAT_LENGTH = 0x60;
export const PROLINK_HEADER_LENGTH = 10;

export const PROLINK_PORTS = {
  keepalive: 50000,
  beat: 50001,
  status: 50002,
} as const;

export type ProlinkPacketType = "beat" | "status" | "keepalive";

const TYPE_BY_ID: Record<number, ProlinkPacketType | undefined> = {
  0x06: "beat",
  0x0a: "status",
  0x02: "keepalive",
  0x08: "status",
};

export interface ProlinkHeader {
  readonly type: ProlinkPacketType;
  readonly deviceName: string;
}

export interface ProlinkBeat {
  readonly kind: "beat";
  readonly header: ProlinkHeader;
  readonly deviceNumber: number;
  readonly nextBeatMs: number;
  readonly secondBeatMs: number;
  readonly pitch: number;
  readonly bpm: number | null;
  readonly beatInBar: number | null;
  readonly trackDevice: number;
}

export interface ProlinkStatusFrame {
  readonly kind: "status";
  readonly header: ProlinkHeader;
  readonly deviceNumber: number;
  readonly trackId: number | null;
  readonly trackSlot: number | null;
  readonly playState: number;
  readonly playing: boolean;
  readonly loopActive: boolean;
  readonly master: boolean;
  readonly sync: boolean;
  readonly beatInBar: number | null;
  readonly pitch: number;
}

export interface ProlinkKeepalive {
  readonly kind: "keepalive";
  readonly header: ProlinkHeader;
  readonly deviceNumber: number;
}

export interface ProlinkMalformed {
  readonly kind: "malformed";
  readonly reason: string;
}

export type ProlinkDecoded = ProlinkBeat | ProlinkStatusFrame | ProlinkKeepalive | ProlinkMalformed;

const view = (data: Uint8Array): DataView => new DataView(data.buffer, data.byteOffset, data.byteLength);

function readAscii(data: Uint8Array, offset: number, length: number): string {
  let text = "";
  for (let i = offset; i < Math.min(offset + length, data.length); i++) {
    const byte = data[i] ?? 0;
    if (byte === 0) break;
    text += String.fromCharCode(byte);
  }
  return text;
}

function malformed(reason: string): ProlinkMalformed {
  return { kind: "malformed", reason };
}

// The 10-byte magic is the first validation gate: a random datagram of the
// right size must still be rejected.
export function decodeProlinkPacket(data: Uint8Array): ProlinkDecoded {
  if (data.length < PROLINK_HEADER_LENGTH + 3) return malformed(`short packet (${data.length} bytes)`);
  const magic = readAscii(data, 0, 10);
  if (magic !== PROLINK_MAGIC) return malformed(`bad magic (${JSON.stringify(magic)})`);
  const type = TYPE_BY_ID[data[10] ?? -1];
  if (!type) return malformed(`unknown packet type 0x${(data[10] ?? 0).toString(16)}`);
  const headerDevice = readAscii(data, 11, 20);
  const deviceNumber = data[0x21] ?? 0;
  const header: ProlinkHeader = { type, deviceName: headerDevice };
  if (type === "beat" && data.length !== PROLINK_BEAT_LENGTH) {
    return malformed(`beat packet must be ${PROLINK_BEAT_LENGTH} bytes, got ${data.length}`);
  }
  if (type === "keepalive" && data.length !== 0x36) {
    return malformed(`keepalive must be 0x36 bytes, got ${data.length}`);
  }
  if (type === "status" && data.length < 0x9c) {
    return malformed(`status packet too short (${data.length} bytes)`);
  }
  const dv = view(data);
  if (type === "beat") {
    const bpmRaw = dv.getUint16(0x5a, true);
    return {
      kind: "beat",
      header,
      deviceNumber,
      nextBeatMs: dv.getUint32(0x24, true) / 100,
      secondBeatMs: dv.getUint32(0x28, true) / 100,
      pitch: dv.getUint32(0x38, true),
      bpm: bpmRaw === 0xffff || bpmRaw === 0 ? null : bpmRaw / 100,
      beatInBar: (data[0x5c] ?? 0) === 0 ? null : data[0x5c]!,
      trackDevice: data[0x5e] ?? 0,
    };
  }
  if (type === "status") {
    const playState = data[0x6f] ?? 0;
    const flags = data[0x75] ?? 0;
    const bpmRaw = dv.getUint16(0x92, true);
    return {
      kind: "status",
      header,
      deviceNumber,
      trackId: dv.getUint32(0x2c, true) || null,
      trackSlot: dv.getUint16(0x28, true) || null,
      playState,
      playing: playState === 3 || playState === 4,
      loopActive: playState === 4,
      master: (flags & 0x20) !== 0,
      sync: (flags & 0x10) !== 0,
      beatInBar: (data[0x94] ?? 0) === 0 ? null : data[0x94]!,
      pitch: dv.getUint32(0x8c, true),
    };
  }
  return { kind: "keepalive", header, deviceNumber };
}

export function pitchPercent(raw: number): number {
  return (raw / 0x100000 - 1) * 100;
}

export function bpmFromPitch(bpm: number, raw: number): number {
  return bpm * (raw / 0x100000);
}

// Golden vector builder for tests: writes a well-formed beat packet with the
// documented field offsets so a decoder regression moves bytes, not a fixture.
export function buildBeatPacket(opts: {
  deviceName: string;
  deviceNumber: number;
  nextBeatMs: number;
  secondBeatMs?: number;
  pitchRaw?: number;
  bpm?: number;
  beatInBar?: number;
}): Uint8Array {
  const out = new Uint8Array(PROLINK_BEAT_LENGTH);
  for (let i = 0; i < PROLINK_MAGIC.length; i++) out[i] = PROLINK_MAGIC.charCodeAt(i);
  out[10] = 0x06;
  for (let i = 0; i < Math.min(opts.deviceName.length, 20); i++) out[11 + i] = opts.deviceName.charCodeAt(i);
  out[0x21] = opts.deviceNumber;
  const dv = view(out);
  dv.setUint32(0x24, Math.round(opts.nextBeatMs * 100), true);
  dv.setUint32(0x28, Math.round((opts.secondBeatMs ?? opts.nextBeatMs) * 100), true);
  dv.setUint32(0x38, opts.pitchRaw ?? 0x100000, true);
  dv.setUint16(0x5a, opts.bpm === undefined ? 0xffff : Math.round(opts.bpm * 100), true);
  out[0x5c] = opts.beatInBar ?? 1;
  out[0x5e] = opts.deviceNumber;
  return out;
}

export function buildStatusPacket(opts: {
  deviceName: string;
  deviceNumber: number;
  trackId: number;
  trackSlot: number;
  playState: number;
  master?: boolean;
  sync?: boolean;
  beatInBar?: number;
  pitchRaw?: number;
  bpm?: number;
}): Uint8Array {
  const out = new Uint8Array(0x9c);
  for (let i = 0; i < PROLINK_MAGIC.length; i++) out[i] = PROLINK_MAGIC.charCodeAt(i);
  out[10] = 0x0a;
  for (let i = 0; i < Math.min(opts.deviceName.length, 20); i++) out[11 + i] = opts.deviceName.charCodeAt(i);
  out[0x21] = opts.deviceNumber;
  const dv = view(out);
  dv.setUint16(0x28, opts.trackSlot, true);
  dv.setUint32(0x2c, opts.trackId, true);
  out[0x6f] = opts.playState;
  out[0x75] = (opts.master ? 0x20 : 0) | (opts.sync ? 0x10 : 0);
  dv.setUint32(0x8c, opts.pitchRaw ?? 0x100000, true);
  dv.setUint16(0x92, opts.bpm === undefined ? 0xffff : Math.round(opts.bpm * 100), true);
  out[0x94] = opts.beatInBar ?? 0;
  return out;
}

export function buildKeepalivePacket(deviceName: string, deviceNumber: number): Uint8Array {
  const out = new Uint8Array(0x36);
  for (let i = 0; i < PROLINK_MAGIC.length; i++) out[i] = PROLINK_MAGIC.charCodeAt(i);
  out[10] = 0x02;
  for (let i = 0; i < Math.min(deviceName.length, 20); i++) out[11 + i] = deviceName.charCodeAt(i);
  out[0x21] = deviceNumber;
  return out;
}

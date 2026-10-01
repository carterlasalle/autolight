import { describe, expect, it } from "vitest";
import {
  arm,
  decodeRaw,
  encodeRaw,
  envelope,
  OPCODE,
  paint,
  paintZoned,
  parseDevStatus,
  parseScanReply,
} from "./razer.js";

// T-QA-12 codec properties (spec 45, T-GOV-02).
// Deterministic LCG, no extra dependency. A flipped checksum bit, a wrong
// length field, or a mangled golden vector fails below.

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("razer codec properties", () => {
  it("round-trips arbitrary opcodes and payloads", () => {
    const rand = lcg(3);
    for (let k = 0; k < 300; k++) {
      const opcode = Math.floor(rand() * 256);
      const len = Math.floor(rand() * 64);
      const payload = new Uint8Array(len);
      for (let i = 0; i < len; i++) payload[i] = Math.floor(rand() * 256);
      const back = decodeRaw(encodeRaw(opcode, payload));
      expect(back).not.toBeNull();
      expect(back!.opcode).toBe(opcode);
      expect(Array.from(back!.payload)).toEqual(Array.from(payload));
    }
  });

  it("rejects any single-bit flip in the frame", () => {
    const rand = lcg(11);
    for (let k = 0; k < 100; k++) {
      const payload = new Uint8Array([1, 2, 3, 4, 5]);
      const frame = encodeRaw(OPCODE.RGB_STREAM, payload);
      const bit = Math.floor(rand() * (frame.length * 8));
      const evil = frame.slice();
      evil[Math.floor(bit / 8)]! ^= 1 << (bit % 8);
      expect(decodeRaw(evil)).toBeNull();
    }
  });

  it("rejects short frames, bad headers, and length lies", () => {
    expect(decodeRaw(new Uint8Array([]))).toBeNull();
    expect(decodeRaw(new Uint8Array([0xbb, 0, 1, 1]))).toBeNull();
    const good = encodeRaw(0xb0, new Uint8Array([9]));
    const wrongMagic = good.slice();
    wrongMagic[0] = 0xba;
    expect(decodeRaw(wrongMagic)).toBeNull();
    const longLie = good.slice();
    longLie[2] = 9;
    expect(decodeRaw(longLie)).toBeNull();
  });

  it("keeps the arm golden vector byte-exact", () => {
    expect(Array.from(arm(true))).toEqual([0xbb, 0x00, 0x01, 0xb1, 0x01, 0x0a]);
    expect(Array.from(arm(false))).toEqual([0xbb, 0x00, 0x01, 0xb1, 0x00, 0x0b]);
  });

  it("envelopes every frame as razer JSON and parses device replies", () => {
    const raw = paint(new Uint8Array([255, 0, 0, 0, 255, 0]));
    const parsed = JSON.parse(envelope(raw)) as { msg: { cmd: string; data: { pt: string } } };
    expect(parsed.msg.cmd).toBe("razer");
    expect(Buffer.from(parsed.msg.data.pt, "base64").length).toBe(raw.length);
    const zoned = paintZoned([{ r: 1, g: 2, b: 3, zone: 7 }]);
    expect(decodeRaw(zoned)!.opcode).toBe(OPCODE.ZONED);
    expect(() => paint(new Uint8Array([1, 2]))).toThrow(RangeError);
    const status = parseDevStatus({
      msg: { cmd: "devStatus", data: { onOff: 1, brightness: 80, color: { r: 1, g: 2, b: 3 }, colorTemInKelvin: 0 } },
    });
    expect(status).toEqual({ onOff: true, brightness: 80, color: { r: 1, g: 2, b: 3 }, colorTemInKelvin: 0 });
    const scan = parseScanReply({
      msg: { cmd: "scan", data: { ip: "1.2.3.4", device: "H6076", sku: "H6076" } },
    });
    expect(scan).not.toBeNull();
    expect(scan!.ip).toBe("1.2.3.4");
    expect(parseScanReply({ msg: { cmd: "scan", data: { ip: "1.2.3.4" } } })).toBeNull();
  });
});

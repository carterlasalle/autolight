import { describe, expect, it } from "vitest";
import { parseBeatGrid, tempoRegionsToBeats, parseCrate } from "./index.js";

function f32be(value: number): number[] {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, value, false);
  return [...new Uint8Array(buf)];
}

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

describe("serato geob (T-SER-03)", () => {
  it("parses the documented single-marker BeatGrid golden", () => {
    // Docs: header 01 00, u32 count 1, terminal (position f32, bpm f32), footer.
    const payload = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00, 0x01, ...f32be(0.303), ...f32be(115), 0x37]);
    const regions = parseBeatGrid(payload);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.startSeconds).toBeCloseTo(0.303, 3);
    expect(regions[0]!.bpm).toBeCloseTo(115);
  });

  it("parses the live ScratchBeat vectors", () => {
    const b4 = parseBeatGrid(new Uint8Array([1, 0, 0, 0, 0, 1, ...f32be(0.046), ...f32be(85), 0]));
    expect(b4[0]!.bpm).toBeCloseTo(85);
    expect(b4[0]!.startSeconds).toBeCloseTo(0.046, 2);
  });

  it("rejects corrupt BeatGrid payloads loudly", () => {
    expect(() => parseBeatGrid(new Uint8Array([2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow();
    expect(() => parseBeatGrid(new Uint8Array([1, 0]))).toThrow();
    expect(() => parseBeatGrid(new Uint8Array([1, 0, 0, 0, 0, 1, 0, 0]))).toThrow();
  });

  it("maps a single tempo region to beat anchors", () => {
    const beats = tempoRegionsToBeats([{ startSeconds: 0, bpm: 120, beatInBar: 1 }]);
    expect(beats).toHaveLength(4);
    expect(beats[0]).toMatchObject({ index: 0, beatInBar: 1, bpm: 120 });
    expect(beats[1]!.sourceTimeMs).toBeCloseTo(500);
  });

  it("runs the last tempo region past four beats", () => {
    const beats = tempoRegionsToBeats([{ startSeconds: 0, bpm: 60, beatInBar: 1 }]);
    // 60 BPM = 1 beat/s; fallback region is 4 beats = 4 s. Must not stop early.
    expect(beats.length).toBeGreaterThanOrEqual(4);
    expect(beats[3]!.sourceTimeMs).toBeCloseTo(3000);
  });

  it("parses a synthetic crate with ordered paths", () => {
    // Tags are ASCII; only track paths are UTF-16BE.
    const ascii = (s: string): number[] => [...s].map((ch) => ch.charCodeAt(0));
    const enc = (s: string): number[] => {
      const out: number[] = [];
      for (const ch of s) out.push(0, ch.charCodeAt(0));
      return out;
    };
    const ptrk = (p: string): number[] => [...ascii("ptrk"), ...u32be(enc(p).length), ...enc(p)];
    const otrkBody = [...ptrk("/m/a.mp3"), ...ptrk("/m/b.mp3")];
    const buf = new Uint8Array([...ascii("vrsn"), ...u32be(0), ...ascii("otrk"), ...u32be(otrkBody.length), ...otrkBody]);
    const entries = parseCrate(buf);
    expect(entries.map((e) => e.path)).toEqual(["/m/a.mp3", "/m/b.mp3"]);
  });

  it("rejects crates with bad magic", () => {
    expect(() => parseCrate(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]))).toThrow();
  });
});

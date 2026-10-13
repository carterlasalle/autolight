import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { parseCrate, parseBeatGrid, remoteToDeckState, tempoRegionsToBeats } from "./index.js";

const home = `${process.env.HOME}/Music/_Serato_`;

const cratePath = `${home}/Subcrates/Recorded.crate`;
const mp3Path = `${home}/Imported/Scratch Beats_/ScratchBeat5.mp3`;

const remoteBase = {
  deckId: 1, filepath: "/m/track.mp3", playing: true, playheadSeconds: 30,
  playRate: 1, effectiveBpm: 128, loopActive: true, loopStartSeconds: 28,
  loopEndSeconds: 32, loopBeatLength: 8, channelFader: 0.8, crossfader: 0.5,
  trackChanged: false, raw: { deck: 1 },
};

describe("serato", () => {
  it.skipIf(!existsSync(cratePath))("parses a real crate", () => {
    const buf = readFileSync(cratePath);
    const entries = parseCrate(buf);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.path.length).toBeGreaterThan(0);
    // Structural check: every entry carries a non-empty path, not just the first.
    for (const entry of entries) expect(entry.path.length).toBeGreaterThan(0);
  });
  it("rejects bad magic", () => {
    expect(() => parseCrate(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]))).toThrow();
  });
  it("normalizes Remote snapshots to DeckState", () => {
    const { state, raw } = remoteToDeckState(remoteBase, 5n);
    expect(state.source).toBe("serato");
    expect(state.track?.sourceIds.seratoPath).toBe("/m/track.mp3");
    expect(state.loop.beatLength).toBe(8);
    expect(state.receivedAtNs).toBe(5n);
    expect(raw).toEqual({ deck: 1 });
  });
  it("coalesces stale loop state on track change", () => {
    const { state } = remoteToDeckState({ ...remoteBase, filepath: "/m/new.mp3", trackChanged: true, loopActive: false }, 6n);
    expect(state.track?.sourceIds.seratoPath).toBe("/m/new.mp3");
    expect(state.loop).toEqual({ active: false, startSeconds: null, endSeconds: null, beatLength: null });
  });
  it("maps tempo regions to beat anchors", () => {
    const beats = tempoRegionsToBeats([{ startSeconds: 0, bpm: 120, beatInBar: 1 }]);
    expect(beats).toHaveLength(4);
    expect(beats[0]).toMatchObject({ index: 0, beatInBar: 1, bpm: 120 });
    expect(beats[1]!.sourceTimeMs).toBeCloseTo(500);
  });
  it("parses real BeatGrid payloads", () => {
    const b4 = parseBeatGrid(new Uint8Array([1, 0, 0, 0, 0, 1, 0x3d, 0x3c, 0x3e, 0x82, 0x42, 0xaa, 0, 0, 0]));
    expect(b4).toHaveLength(1);
    expect(b4[0]!.bpm).toBeCloseTo(85);
    expect(b4[0]!.startSeconds).toBeCloseTo(0.046, 2);
  });
  it.skipIf(!existsSync(mp3Path))("parses the on-disk BeatGrid region", () => {
    const buf = readFileSync(mp3Path);
    const at = buf.indexOf("Serato BeatGrid");
    expect(at).toBeGreaterThan(0);
    const o = at + "Serato BeatGrid".length + 1;
    expect(o + 15).toBeLessThanOrEqual(buf.length);
    const region = buf.subarray(o, o + 15);
    const payload = new Uint8Array(region.buffer, region.byteOffset, 15);
    const regions = parseBeatGrid(payload);
    expect(regions.length).toBeGreaterThan(0);
    expect(regions[0]!.bpm).toBeCloseTo(88);
  });
  it("rejects corrupt BeatGrid payloads", () => {
    expect(() => parseBeatGrid(new Uint8Array([2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow(/version=2/);
    expect(() => parseBeatGrid(new Uint8Array([1, 0]))).toThrow(/too short/);
  });
});

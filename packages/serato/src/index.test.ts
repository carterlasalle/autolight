import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { parseCrate, parseBeatGrid, remoteToDeckState, tempoRegionsToBeats } from "./index.js";

const home = `${process.env.HOME}/Music/_Serato_`;
const hasLibrary = existsSync(`${home}/Subcrates/Recorded.crate`);

const remoteBase = {
  deckId: 1, filepath: "/m/track.mp3", playing: true, playheadSeconds: 30,
  playRate: 1, effectiveBpm: 128, loopActive: true, loopStartSeconds: 28,
  loopEndSeconds: 32, loopBeatLength: 8, channelFader: 0.8, crossfader: 0.5,
  trackChanged: false, raw: { deck: 1 },
};

describe("serato", () => {
  it("parses a real crate", () => {
    if (!hasLibrary) return; // CI has no ~/Music — synthetic cases below cover parsing
    const buf = readFileSync(`${home}/Subcrates/Recorded.crate`);
    const entries = parseCrate(buf);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.path.length).toBeGreaterThan(0);
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
    if (!hasLibrary) return;
    const buf = readFileSync(`${home}/Imported/Scratch Beats_/ScratchBeat5.mp3`);
    const at = buf.indexOf("Serato BeatGrid");
    expect(at).toBeGreaterThan(0);
    const o = at + "Serato BeatGrid".length + 1;
    const payload = new Uint8Array(buf.buffer, buf.byteOffset + o, 15);
    expect(parseBeatGrid(payload)[0]!.bpm).toBeCloseTo(88);
  });
  it("rejects corrupt BeatGrid payloads", () => {
    expect(() => parseBeatGrid(new Uint8Array([2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow();
    expect(() => parseBeatGrid(new Uint8Array([1, 0]))).toThrow();
  });
});

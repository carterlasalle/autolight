import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseCrate, remoteToDeckState, tempoRegionsToBeats } from "./index.js";

const remoteBase = {
  deckId: 1, filepath: "/m/track.mp3", playing: true, playheadSeconds: 30,
  playRate: 1, effectiveBpm: 128, loopActive: true, loopStartSeconds: 28,
  loopEndSeconds: 32, loopBeatLength: 8, channelFader: 0.8, crossfader: 0.5,
  trackChanged: false, raw: { deck: 1 },
};

describe("serato", () => {
  it("parses a real crate", () => {
    const buf = readFileSync(`${process.env.HOME}/Music/_Serato_/Subcrates/Recorded.crate`);
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
});

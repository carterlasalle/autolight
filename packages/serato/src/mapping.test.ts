import { describe, expect, it } from "vitest";
import { remoteToDeckState, type SeratoRemoteDeck } from "./index.js";

const base: SeratoRemoteDeck = {
  deckId: 1,
  filepath: "/music/track-a.mp3",
  playing: true,
  playheadSeconds: 61.25,
  playRate: 1.02,
  effectiveBpm: 124.5,
  loopActive: true,
  loopStartSeconds: 60,
  loopEndSeconds: 62,
  loopBeatLength: 4,
  channelFader: 0.9,
  crossfader: 0.2,
  trackChanged: false,
  raw: { deck: 1 },
};

describe("serato remote mapping (T-SER-02)", () => {
  it("maps every reported field into DeckState", () => {
    const { state, raw } = remoteToDeckState(base, 100n);
    expect(state.source).toBe("serato");
    expect(state.deckId).toBe(1);
    expect(state.track?.sourceIds.seratoPath).toBe("/music/track-a.mp3");
    expect(state.track?.canonicalPath).toBe("/music/track-a.mp3");
    expect(state.playing).toBe(true);
    expect(state.playheadSeconds).toBe(61.25);
    expect(state.playRate).toBe(1.02);
    expect(state.effectiveBpm).toBe(124.5);
    expect(state.loop).toEqual({ active: true, startSeconds: 60, endSeconds: 62, beatLength: 4 });
    expect(state.channelFader).toBe(0.9);
    expect(state.crossfader).toBe(0.2);
    expect(state.receivedAtNs).toBe(100n);
    expect(raw).toEqual({ deck: 1 });
  });

  it("maps each deck id without cross-talk", () => {
    for (const deckId of [1, 2, 3, 4]) {
      const { state } = remoteToDeckState({ ...base, deckId }, 1n);
      expect(state.deckId).toBe(deckId);
    }
  });

  it("passes null optionals through untouched", () => {
    const { state } = remoteToDeckState(
      {
        ...base,
        effectiveBpm: null,
        loopActive: false,
        loopStartSeconds: null,
        loopEndSeconds: null,
        loopBeatLength: null,
        channelFader: null,
        crossfader: null,
      },
      2n,
    );
    expect(state.effectiveBpm).toBeNull();
    expect(state.loop).toEqual({ active: false, startSeconds: null, endSeconds: null, beatLength: null });
    expect(state.channelFader).toBeNull();
    expect(state.crossfader).toBeNull();
  });

  it("maps a null filepath to a null track", () => {
    const { state } = remoteToDeckState(
      { ...base, filepath: null, trackChanged: true, loopActive: false, loopStartSeconds: null, loopEndSeconds: null, loopBeatLength: null },
      3n,
    );
    expect(state.track).toBeNull();
    expect(state.loop).toEqual({ active: false, startSeconds: null, endSeconds: null, beatLength: null });
  });

  it("coalesces stale loop state on track change", () => {
    const { state } = remoteToDeckState(
      { ...base, filepath: "/music/track-b.mp3", trackChanged: true, loopActive: false },
      4n,
    );
    expect(state.track?.sourceIds.seratoPath).toBe("/music/track-b.mp3");
    expect(state.loop).toEqual({ active: false, startSeconds: null, endSeconds: null, beatLength: null });
  });

  it("keeps a re-asserted loop on the same track", () => {
    const { state } = remoteToDeckState(base, 5n);
    expect(state.track?.sourceIds.seratoPath).toBe("/music/track-a.mp3");
    expect(state.loop.active).toBe(true);
    expect(state.loop.beatLength).toBe(4);
  });

  it("resolves the file path to a path-based TrackId", () => {
    const { state } = remoteToDeckState(base, 6n);
    expect(state.track?.id).toBe("path:/music/track-a.mp3");
  });
});

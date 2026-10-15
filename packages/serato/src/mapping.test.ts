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
    // Distinct non-deckId values per deck: a stateless mapper that leaked
    // track/loop/fader state across decks would fail these, unlike a
    // deckId-only echo assertion.
    const decks: SeratoRemoteDeck[] = [
      { ...base, deckId: 1, filepath: "/music/one.mp3", channelFader: 0.11, crossfader: 0.21, playheadSeconds: 11 },
      { ...base, deckId: 2, filepath: "/music/two.mp3", channelFader: 0.22, crossfader: 0.32, playheadSeconds: 22 },
      { ...base, deckId: 3, filepath: "/music/three.mp3", channelFader: 0.33, crossfader: 0.43, playheadSeconds: 33 },
      { ...base, deckId: 4, filepath: "/music/four.mp3", channelFader: 0.44, crossfader: 0.54, playheadSeconds: 44 },
    ];

    for (const deck of decks) {
      const { state } = remoteToDeckState(deck, BigInt(deck.deckId));

      expect(state.deckId).toBe(deck.deckId);
      expect(state.track?.canonicalPath).toBe(deck.filepath);
      expect(state.loop).toEqual({ active: true, startSeconds: 60, endSeconds: 62, beatLength: 4 });
      expect(state.playheadSeconds).toBe(deck.playheadSeconds);
      expect(state.effectiveBpm).toBe(124.5);
      expect(state.channelFader).toBe(deck.channelFader);
      expect(state.crossfader).toBe(deck.crossfader);
      expect(state.receivedAtNs).toBe(BigInt(deck.deckId));
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

  it("clears the track on a null filepath without touching other state", () => {
    // Track unloaded without a reported track change: the null track must
    // not clobber playhead, rate, tempo or faders, and the loop fields
    // still travel as reported (the reset is gated on trackChanged).
    const { state } = remoteToDeckState(
      { ...base, filepath: null, playing: false, playheadSeconds: 0, trackChanged: false },
      7n,
    );

    expect(state.track).toBeNull();
    expect(state.playing).toBe(false);
    expect(state.playheadSeconds).toBe(0);
    expect(state.playRate).toBe(1.02);
    expect(state.effectiveBpm).toBe(124.5);
    expect(state.loop).toEqual({ active: true, startSeconds: 60, endSeconds: 62, beatLength: 4 });
    expect(state.channelFader).toBe(0.9);
    expect(state.crossfader).toBe(0.2);
    expect(state.receivedAtNs).toBe(7n);
  });

  it("coalesces stale loop state on track change", () => {
    const { state } = remoteToDeckState(
      { ...base, filepath: "/music/track-b.mp3", trackChanged: true, loopActive: false },
      4n,
    );

    expect(state.track?.sourceIds.seratoPath).toBe("/music/track-b.mp3");
    expect(state.loop).toEqual({ active: false, startSeconds: null, endSeconds: null, beatLength: null });
  });

  it("keeps a re-asserted loop on a changed track", () => {
    // trackChanged && loopActive=true: the new-track message carries fresh
    // loop bounds, and those (not a reset) are what survives. This is the
    // branch the old same-track reuse never exercised.
    const { state } = remoteToDeckState(
      {
        ...base,
        filepath: "/music/track-b.mp3",
        trackChanged: true,
        loopActive: true,
        loopStartSeconds: 12.5,
        loopEndSeconds: 14.5,
        loopBeatLength: 8,
      },
      5n,
    );

    expect(state.track?.sourceIds.seratoPath).toBe("/music/track-b.mp3");
    expect(state.loop).toEqual({ active: true, startSeconds: 12.5, endSeconds: 14.5, beatLength: 8 });
  });

  it("passes an active loop with missing bounds through as reported", () => {
    // The decoder is stateless: a track-change message that reports an active
    // loop but no bounds is carried as-is (nulls), never invented. The reset
    // only fires when the new-track message reports no active loop.
    const { state } = remoteToDeckState(
      { ...base, filepath: "/music/track-b.mp3", trackChanged: true, loopActive: true, loopStartSeconds: null, loopEndSeconds: null, loopBeatLength: null },
      8n,
    );

    expect(state.loop).toEqual({ active: true, startSeconds: null, endSeconds: null, beatLength: null });
  });

  it("passes out-of-range boundaries through untouched", () => {
    // This layer is a faithful transport mapping: values travel exactly as
    // reported. It performs no sanitization, so the test pins the
    // pass-through instead of inventing a guard the decoder does not own.
    const { state } = remoteToDeckState(
      {
        ...base,
        playheadSeconds: Number.NaN,
        playRate: -1,
        effectiveBpm: Number.POSITIVE_INFINITY,
        loopStartSeconds: 20,
        loopEndSeconds: 10,
        channelFader: Number.NaN,
      },
      9n,
    );

    expect(state.playheadSeconds).toBeNaN();
    expect(state.playRate).toBe(-1);
    expect(state.effectiveBpm).toBe(Number.POSITIVE_INFINITY);
    expect(state.loop).toEqual({ active: true, startSeconds: 20, endSeconds: 10, beatLength: 4 });
    expect(state.channelFader).toBeNaN();
  });

  it("resolves the file path to a path-based TrackId", () => {
    const { state } = remoteToDeckState(base, 6n);
    expect(state.track?.id).toBe("path:/music/track-a.mp3");
  });
});

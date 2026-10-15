import { describe, expect, it } from "vitest";
import { deckStateSchema, sourceSecondsToBeat, beatToSourceSeconds, type BeatGrid, type DeckState } from "./index.js";

const grid: BeatGrid = { version: 1, beats: [
  { index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 },
  { index: 1, beatInBar: 2, sourceTimeMs: 468.75, bpm: 128 },
  { index: 2, beatInBar: 3, sourceTimeMs: 937.5, bpm: 128 },
]};

describe("contracts", () => {
  it("rejects bad fader", () => {
    // A schema-valid DeckState fixture: a typo'd or reshaped field is a
    // compile error here instead of hiding behind `any` (batch-51).
    const good: DeckState = { source: "rekordbox", deckId: 1, track: null, playing: true, playheadSeconds: 0, playRate: 1, effectiveBpm: 128, loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null }, channelFader: 1, crossfader: null, master: null, receivedAtNs: 0n };

    // The valid state parses, so the negative case fails for the fader alone.
    expect(deckStateSchema.safeParse(good).success).toBe(true);
    const bad = { ...good, channelFader: 9 };
    const result = deckStateSchema.safeParse(bad);

    expect(result.success).toBe(false);
    // The rejection must name channelFader as too big, not an unrelated field.
    expect(result.success ? [] : result.error.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "too_big", path: ["channelFader"] })]),
    );
  });

  it("maps beat grid both ways", () => {
    expect(sourceSecondsToBeat(grid, 0.46875)).toBeCloseTo(1);
    expect(beatToSourceSeconds(grid, 1)).toBeCloseTo(0.46875);
    // Strictly between anchors: a broken search or span formula cannot hide
    // behind the round-trip cancelling itself (batch-51).
    expect(sourceSecondsToBeat(grid, 0.6)).toBeCloseTo(1 + (600 - 468.75) / 468.75, 6);
    expect(beatToSourceSeconds(grid, 1.5)).toBeCloseTo(0.703125, 6);
    // Before the first anchor and past the last: both ends defined.
    expect(sourceSecondsToBeat(grid, -1)).toBe(0);
    expect(sourceSecondsToBeat(grid, 2)).toBeCloseTo(1 + (2000 - 468.75) / 468.75, 6);
    expect(beatToSourceSeconds(grid, 5)).toBeCloseTo(0.9375, 6);
  });
});

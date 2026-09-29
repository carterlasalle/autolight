import { describe, expect, it } from "vitest";
import { deckStateSchema, sourceSecondsToBeat, beatToSourceSeconds, type BeatGrid } from "./index.js";

const grid: BeatGrid = { version: 1, beats: [
  { index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 },
  { index: 1, beatInBar: 2, sourceTimeMs: 468.75, bpm: 128 },
  { index: 2, beatInBar: 3, sourceTimeMs: 937.5, bpm: 128 },
]};

describe("contracts", () => {
  it("rejects bad fader", () => {
    const bad: any = { source: "rekordbox", deckId: 1, track: null, playing: true, playheadSeconds: 0, playRate: 1, effectiveBpm: 128, loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null }, channelFader: 9, crossfader: null, master: null, receivedAtNs: 0n };
    expect(deckStateSchema.safeParse(bad).success).toBe(false);
  });
  it("maps beat grid both ways", () => {
    expect(sourceSecondsToBeat(grid, 0.46875)).toBeCloseTo(1);
    expect(beatToSourceSeconds(grid, 1)).toBeCloseTo(0.46875);
  });
});

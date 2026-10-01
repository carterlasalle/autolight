import { describe, expect, it } from "vitest";
import { beatToSourceSeconds, sourceSecondsToBeat, type BeatGrid, type DeckState } from "@autolight/contracts";
import {
  estimatePosition,
  exceedsSeekThreshold,
  isSeek,
} from "./index.js";

// T-QA-12 beat mapping properties (spec 74, T-RUN-03).
// Deterministic LCG, no extra dependency. Failing-capable: any off-by-one in
// the binary search, a flipped threshold, or a non-monotonic map fails below.

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function gridAt(bpm: number, beats: number, driftBpm = 0): BeatGrid {
  const out: BeatGrid = { version: 1, beats: [] };
  let ms = 0;
  for (let i = 0; i < beats; i++) {
    const b = bpm + driftBpm * (i / Math.max(1, beats - 1));
    out.beats.push({ index: i, beatInBar: ((i % 4) + 1) as 1 | 2 | 3 | 4, sourceTimeMs: ms, bpm: b });
    ms += 60000 / b;
  }
  return out;
}

const deck = (over: Partial<DeckState> = {}): DeckState => ({
  source: "rekordbox", deckId: 1, track: { id: "t", sourceIds: {} }, playing: true,
  playheadSeconds: 10, playRate: 1, effectiveBpm: 128,
  loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null },
  channelFader: 1, crossfader: 1, master: true, receivedAtNs: 0n, ...over,
});

describe("beat mapping properties", () => {
  it("round-trips beat -> seconds -> beat on fixed and drifting grids", () => {
    for (const g of [gridAt(128, 256), gridAt(100, 256, 28), gridAt(174, 512, -40)]) {
      const rand = lcg(7);
      for (let k = 0; k < 200; k++) {
        const beat = rand() * 250;
        const back = sourceSecondsToBeat(g, beatToSourceSeconds(g, beat));
        expect(Math.abs(back - beat)).toBeLessThan(1e-6);
      }
    }
  });

  it("is monotone non-decreasing in source time", () => {
    const g = gridAt(120, 300, 15);
    let prev = -Infinity;
    for (let s = 0; s < 600; s += 0.25) {
      const b = sourceSecondsToBeat(g, s);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it("clamps out-of-range beats to the grid ends", () => {
    const g = gridAt(128, 64);
    expect(beatToSourceSeconds(g, -5)).toBeCloseTo(beatToSourceSeconds(g, 0), 9);
    expect(beatToSourceSeconds(g, 5000)).toBeCloseTo(beatToSourceSeconds(g, 63), 9);
  });

  it("extrapolates linearly while playing and holds while paused", () => {
    const rand = lcg(21);
    for (let k = 0; k < 100; k++) {
      const start = rand() * 300;
      const rate = 0.84 + rand() * 0.32; // pitch +-8/16pct around 1x
      const dtNs = BigInt(Math.floor(rand() * 5e9));
      const d = deck({ playheadSeconds: start, playRate: rate, receivedAtNs: 0n });
      expect(estimatePosition(d, dtNs)).toBeCloseTo(start + (Number(dtNs) / 1e9) * rate, 9);
      expect(estimatePosition({ ...d, playing: false }, dtNs)).toBe(start);
    }
  });

  it("seek detectors agree at the boundary and never invert", () => {
    expect(isSeek(10, 10.2, 0.25)).toBe(false);
    expect(isSeek(10, 10.3, 0.25)).toBe(true);
    const rand = lcg(99);
    for (let k = 0; k < 200; k++) {
      const predicted = rand() * 500;
      const observed = predicted + (rand() - 0.5) * 4;
      const beats = 1.5 + rand() * 1.5;
      const errBeats = Math.abs(observed - predicted);
      const got = exceedsSeekThreshold(predicted, observed, beats);
      if (errBeats > 0.5 * (1 + 1e-9)) expect(got).toBe(true);
      if (errBeats < 0.4 && (errBeats / beats) * 1000 < 140) expect(got).toBe(false);
    }
  });
});

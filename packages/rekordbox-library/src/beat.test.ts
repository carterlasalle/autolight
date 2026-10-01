// P-2.2-grid-truth and P-74-mapping: one beat origin, round-trip property over
// generated variable-tempo grids, monotonicity in both directions and the
// million-mapping benchmark (T-RBL-03; F-RBL-06, F-RBL-09).
import { describe, expect, it } from "vitest";
import {
  beatOfIndex,
  beatToSourceSeconds,
  indexOfBeat,
  sourceSecondsToBeat,
  toNativeBeat,
  type Beat,
  type BeatAnchor,
  type BeatGridLike,
  type BeatIndex0,
  type Seconds,
} from "./beat.js";

const GRIDS = 10_000;
const ROUND_TRIP_SECONDS_TOLERANCE = 1e-6;
const ROUND_TRIP_BEATS_TOLERANCE = 1e-9;
const BENCH_BEATS = 2000;
const BENCH_MAPPINGS = 1_000_000;
const BENCH_LIMIT_MS = 250;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function variableTempoGrid(rand: () => number, beatCount: number, startMs: number): BeatGridLike & { beats: BeatAnchor[] } {
  const beats: BeatAnchor[] = [];
  let timeMs = startMs;
  for (let i = 0; i < beatCount; i++) {
    const bpm = 80 + rand() * 100;
    beats.push({ index: i, beatInBar: ((i % 4) + 1) as 1 | 2 | 3 | 4, sourceTimeMs: timeMs, bpm });
    timeMs += (60 / bpm) * 1000;
  }
  return { beats };
}

describe("beat domain", () => {
  it("keeps the 1-based beat and 0-based index convention", () => {
    expect(beatOfIndex(0 as BeatIndex0)).toBe(1);
    expect(beatOfIndex(41 as BeatIndex0)).toBe(42);
    expect(indexOfBeat(1 as Beat)).toBe(0);
    expect(indexOfBeat(42 as Beat)).toBe(41);
  });

  it("converts PQTZ seconds to milliseconds once", () => {
    expect(toNativeBeat({ index: 0, beatInBar: 1, sourceTimeSeconds: 0.05, bpm: 142 }).sourceTimeMs).toBe(50);
    expect(toNativeBeat({ index: 3, beatInBar: 4, sourceTimeSeconds: 1.473, bpm: 128 }).sourceTimeMs).toBeCloseTo(1473, 9);
  });

  it("rejects malformed PQTZ beats", () => {
    expect(() => toNativeBeat({ index: 0, beatInBar: 5, sourceTimeSeconds: 0, bpm: 128 })).toThrow(RangeError);
    expect(() => toNativeBeat({ index: -1, beatInBar: 1, sourceTimeSeconds: 0, bpm: 128 })).toThrow(RangeError);
    expect(() => toNativeBeat({ index: 0, beatInBar: 1, sourceTimeSeconds: -1, bpm: 128 })).toThrow(RangeError);
  });

  it("maps phrase start beat 1 onto anchor index 0 exactly", () => {
    const grid = variableTempoGrid(mulberry32(7), 64, 12_345.678);
    expect(beatToSourceSeconds(grid, 1 as Beat)).toBe(grid.beats[0]!.sourceTimeMs / 1000);
    expect(sourceSecondsToBeat(grid, (grid.beats[0]!.sourceTimeMs / 1000) as Seconds)).toBe(1);
  });

  it("round trips 10,000 generated variable-tempo grids within 1e-6 s", () => {
    const rand = mulberry32(20260930);
    for (let g = 0; g < GRIDS; g++) {
      const beatCount = 4 + Math.floor(rand() * 60);
      const startMs = rand() * 60_000;
      const grid = variableTempoGrid(rand, beatCount, startMs);
      const gridSecondsStart = grid.beats[0]!.sourceTimeMs / 1000;
      const gridSecondsEnd = grid.beats[beatCount - 1]!.sourceTimeMs / 1000;
      const span = gridSecondsEnd - gridSecondsStart;
      for (let sample = 0; sample < 12; sample++) {
        // Some samples deliberately fall outside the grid: the edge policy
        // extrapolates, so the round trip must hold there too.
        const offset = -0.25 + rand() * 1.5;
        const seconds = (gridSecondsStart + span * offset) as Seconds;
        const beat = sourceSecondsToBeat(grid, seconds);
        const back = beatToSourceSeconds(grid, beat);
        expect(Math.abs(back - seconds)).toBeLessThanOrEqual(ROUND_TRIP_SECONDS_TOLERANCE);
        const beatBack = sourceSecondsToBeat(grid, back);
        expect(Math.abs(beatBack - beat)).toBeLessThanOrEqual(ROUND_TRIP_BEATS_TOLERANCE * Math.max(1, Math.abs(beat)));
      }
    }
  });

  it("is monotonic in both directions, inside and outside the grid", () => {
    const rand = mulberry32(4242);
    const grid = variableTempoGrid(rand, 128, 1_000);
    let previousSeconds = -Infinity;
    let previousBeat = -Infinity;
    for (let i = -30; i <= 160; i++) {
      const beat = (i / 2) as Beat;
      const seconds = beatToSourceSeconds(grid, beat);
      expect(seconds).toBeGreaterThan(previousSeconds);
      previousSeconds = seconds;
      const backBeat = sourceSecondsToBeat(grid, seconds);
      expect(backBeat).toBeGreaterThan(previousBeat);
      previousBeat = backBeat;
    }
  });

  it("uses the nearest segment's tempo beyond the ends instead of clamping", () => {
    const grid = variableTempoGrid(mulberry32(11), 8, 0);
    const first = grid.beats[0]!;
    const second = grid.beats[1]!;
    const beatLengthMs = second.sourceTimeMs - first.sourceTimeMs;
    expect(beatToSourceSeconds(grid, 0 as Beat)).toBeCloseTo((first.sourceTimeMs - beatLengthMs) / 1000, 9);
    const last = grid.beats[7]!;
    const beforeLast = grid.beats[6]!;
    const lastSegMs = last.sourceTimeMs - beforeLast.sourceTimeMs;
    expect(beatToSourceSeconds(grid, 10 as Beat)).toBeCloseTo((last.sourceTimeMs + 2 * lastSegMs) / 1000, 9);
  });

  it("rejects an empty grid", () => {
    expect(() => beatToSourceSeconds({ beats: [] }, 1 as Beat)).toThrow(RangeError);
    expect(() => sourceSecondsToBeat({ beats: [] }, 0 as Seconds)).toThrow(RangeError);
  });

  it("maps a million points on a 2,000-beat grid within the budget", () => {
    const grid = variableTempoGrid(mulberry32(99), BENCH_BEATS, 0);
    const started = performance.now();
    let accumulator = 0;
    for (let i = 0; i < BENCH_MAPPINGS / 2; i++) {
      const beat = ((i % (BENCH_BEATS * 2)) / 2) as Beat;
      accumulator += beatToSourceSeconds(grid, beat);
    }
    for (let i = 0; i < BENCH_MAPPINGS / 2; i++) {
      const seconds = ((i % (BENCH_BEATS * 2)) / 2) as Seconds;
      accumulator += sourceSecondsToBeat(grid, seconds);
    }
    const elapsedMs = performance.now() - started;
    expect(Number.isFinite(accumulator)).toBe(true);
    expect(elapsedMs).toBeLessThan(BENCH_LIMIT_MS);
    console.log(`P-74-mapping benchmark: ${BENCH_MAPPINGS} mappings on ${BENCH_BEATS} beats in ${elapsedMs.toFixed(1)} ms`);
  });
});

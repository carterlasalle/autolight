// Onset-driven tempo estimation, ported small from LED_PARTY's audiosync:
// spectral flux in, BPM out. Pure and frame-fed — the caller supplies samples
// and timestamps, so it is testable without audio hardware and carries no
// permission of its own. Only ever runs once the operator starts a capture.

export interface TempoTrackerOptions {
  /** Below this the estimate is not reported (default 60). */
  minBpm?: number;
  /** Above this the estimate is not reported (default 200). */
  maxBpm?: number;
  /** Onsets closer together than this are treated as one hit (ms). */
  refractoryMs?: number;
}

export interface TempoTracker {
  /** Feed one spectral-flux sample; returns the current BPM or null. */
  push(flux: number, tMs: number): number | null;
  reset(): void;
}

const DEFAULTS = {
  minBpm: 60,
  maxBpm: 200,
  refractoryMs: 200,
  // Onset detection: flux must exceed the slow mean by this factor.
  onsetFactor: 1.6,
  // Estimates within this relative distance blend into the stable value;
  // farther ones must repeat before replacing it (a one-off accent must not
  // yank the tempo).
  blendWindow: 0.1,
  outliersToReplace: 3,
  intervalsKept: 8,
} as const;

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const a = sorted[mid] ?? 0;
  const b = sorted[mid - 1] ?? a;

  return sorted.length % 2 === 0 ? (a + b) / 2 : a;
};

export function createTempoTracker(opts: TempoTrackerOptions = {}): TempoTracker {
  const minBpm = opts.minBpm ?? DEFAULTS.minBpm;
  const maxBpm = opts.maxBpm ?? DEFAULTS.maxBpm;
  const refractoryMs = opts.refractoryMs ?? DEFAULTS.refractoryMs;

  let mean = 0;
  let lastOnsetMs = Number.NEGATIVE_INFINITY;
  let intervals: number[] = [];
  let stable: number | null = null;
  let outliers = 0;

  const reset = (): void => {
    mean = 0;
    lastOnsetMs = Number.NEGATIVE_INFINITY;
    intervals = [];
    stable = null;
    outliers = 0;
  };

  const push = (flux: number, tMs: number): number | null => {
    // Slow mean tracks the floor; onsets are spikes above it.
    mean = mean === 0 ? flux : mean * 0.95 + flux * 0.05;

    const isOnset = flux > 1e-6 && flux > mean * DEFAULTS.onsetFactor && tMs - lastOnsetMs >= refractoryMs;

    if (!isOnset) return stable === null ? null : Math.round(stable);
    const gap = tMs - lastOnsetMs;

    lastOnsetMs = tMs;

    if (!Number.isFinite(gap)) return stable === null ? null : Math.round(stable);
    intervals = [...intervals, gap].slice(-DEFAULTS.intervalsKept);

    if (intervals.length < 2) return stable === null ? null : Math.round(stable);
    const bpm = 60_000 / median(intervals);

    if (bpm < minBpm || bpm > maxBpm) return stable === null ? null : Math.round(stable);

    if (stable === null) {
      stable = bpm;

      return Math.round(stable);
    }

    const rel = Math.abs(bpm - stable) / stable;

    if (rel <= DEFAULTS.blendWindow) {
      stable = stable * 0.75 + bpm * 0.25;
      outliers = 0;
    } else if (++outliers >= DEFAULTS.outliersToReplace) {
      // The tempo really changed: three consistent far-off estimates in a
      // row replace the stable value instead of being averaged away.
      stable = bpm;
      outliers = 0;
    }

    return Math.round(stable);
  };

  return { push, reset };
}

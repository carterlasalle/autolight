// Beat domain, units and beat-to-time mapping (§2.2, §73, §74; T-RBL-03,
// closes F-RBL-06 and F-RBL-09).
//
// One convention everywhere (ADR-009): musical position is `Beat`, fractional
// and 1-based, so beat 1 is the first native grid beat and equals the time of
// grid anchor `index 0`; the grid itself keeps the 0-based `index`. PSSI phrase
// beats, cue beats, ML boundaries and planner cues all speak `Beat`.
//
// Grid times are milliseconds in the source file domain (`sourceTimeMs`);
// seconds appear only at the boundary (`Seconds`). `toNativeBeat` takes
// `sourceTimeSeconds` from pyrekordbox's PQTZ reader and converts once to
// `sourceTimeMs` (the old signature took an already-scaled field named
// `sourceTimeMs` and multiplied it by 1000 again, which is F-RBL-09).
//
// Edge policy for both directions, documented and shared: inside the grid the
// mapping is piecewise linear between anchors; before the first anchor and
// after the last one it extrapolates with the nearest segment's tempo rather
// than clamping, so both directions stay monotonic and inverse of each other
// outside the grid too. Both directions binary search (§74).
export type Beat = number & { readonly __beat: unique symbol };
export type BeatIndex0 = number & { readonly __beatIndex: unique symbol };
export type Seconds = number & { readonly __seconds: unique symbol };
export type Milliseconds = number & { readonly __milliseconds: unique symbol };
export type Ns = bigint & { readonly __ns: unique symbol };

export const MS_PER_SECOND = 1000;
export const NS_PER_MS = 1_000_000n;

/** Grid anchor as stored in the native analysis (`index` is 0-based). */
export interface BeatAnchor {
  index: number;
  beatInBar: 1 | 2 | 3 | 4;
  sourceTimeMs: number;
  bpm: number;
}

/** Minimal grid shape shared with `@autolight/contracts`' BeatGrid. */
export interface BeatGridLike {
  beats: readonly { index: number; sourceTimeMs: number }[];
}

/** 0-based grid index to 1-based fractional musical beat. */
export const beatOfIndex = (index: BeatIndex0): Beat => (index + 1) as Beat;
/** 1-based fractional musical beat to 0-based grid index. */
export const indexOfBeat = (beat: Beat): BeatIndex0 => (beat - 1) as BeatIndex0;

// PQTZ reader output (pyrekordbox scales tempo to BPM and time to seconds).
export interface PqtzBeat {
  index: number;
  beatInBar: number;
  sourceTimeSeconds: number;
  bpm: number;
}

export function toNativeBeat(raw: PqtzBeat): BeatAnchor {
  if (!Number.isInteger(raw.index) || raw.index < 0) throw new RangeError(`index=${raw.index}, expected a non-negative integer`);
  if (![1, 2, 3, 4].includes(raw.beatInBar)) throw new RangeError(`beatInBar=${raw.beatInBar}, expected 1-4`);
  if (!Number.isFinite(raw.sourceTimeSeconds) || raw.sourceTimeSeconds < 0) {
    throw new RangeError(`sourceTimeSeconds=${raw.sourceTimeSeconds}, expected a finite non-negative number`);
  }
  return {
    index: raw.index,
    beatInBar: raw.beatInBar as 1 | 2 | 3 | 4,
    sourceTimeMs: raw.sourceTimeSeconds * MS_PER_SECOND,
    bpm: raw.bpm,
  };
}

// Largest anchor position whose anchor time is <= ms; edges pin to the first or
// last segment so extrapolation uses the nearest tempo.
function anchorPosition(beats: BeatGridLike["beats"], ms: number): number {
  const last = beats.length - 1;
  if (ms <= beats[0]!.sourceTimeMs) return 0;
  if (ms >= beats[last]!.sourceTimeMs) return Math.max(last - 1, 0);
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid]!.sourceTimeMs <= ms) lo = mid;
    else hi = mid;
  }
  return lo;
}

// Largest anchor position whose anchor beat is <= beat; edges pin to the first
// or last segment so extrapolation uses the nearest tempo.
function beatCaret(beats: BeatGridLike["beats"], beat: Beat): number {
  const last = beats.length - 1;
  if (beat <= beats[0]!.index + 1) return 0;
  if (beat >= beats[last]!.index + 1) return Math.max(last - 1, 0);
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid]!.index + 1 <= beat) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Fractional beat to seconds in the source file, piecewise linear (§74). */
export function beatToSourceSeconds(grid: BeatGridLike, beat: Beat): Seconds {
  const beats = grid.beats;
  if (beats.length === 0) throw new RangeError("empty beat grid");
  const p = beatCaret(beats, beat);
  const a = beats[p]!;
  const c = beats[p + 1] ?? a;
  const span = c.sourceTimeMs - a.sourceTimeMs;
  const beatSpan = c.index - a.index;
  const from = a.index + 1;
  if (span <= 0 || beatSpan <= 0) return (a.sourceTimeMs / MS_PER_SECOND) as Seconds;
  const ms = a.sourceTimeMs + (span * (beat - from)) / beatSpan;
  return (ms / MS_PER_SECOND) as Seconds;
}

/** Seconds in the source file to fractional beat, piecewise linear (§74). */
export function sourceSecondsToBeat(grid: BeatGridLike, seconds: Seconds): Beat {
  const beats = grid.beats;
  if (beats.length === 0) throw new RangeError("empty beat grid");
  const ms = seconds * MS_PER_SECOND;
  const p = anchorPosition(beats, ms);
  const a = beats[p]!;
  const c = beats[p + 1] ?? a;
  const span = c.sourceTimeMs - a.sourceTimeMs;
  const beatSpan = c.index - a.index;
  if (span <= 0 || beatSpan <= 0) return (a.index + 1) as Beat;
  return (a.index + 1 + (beatSpan * (ms - a.sourceTimeMs)) / span) as Beat;
}

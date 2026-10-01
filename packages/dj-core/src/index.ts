import type { DeckState } from "@autolight/contracts";
export type { DeckState };

// ---------------------------------------------------------------------------
// State estimator (spec 57, T-RUN-02)

// `estimated = P + (now - T) * R` while playing. Small errors are corrected by
// a slew-limited phase correction so the beat never steps backwards while
// playing; large errors become transport events (seek, T-RUN-03). An
// observation's quality weights the correction: an `exact` rkbx-osc time
// corrects faster than an `estimated` AX time.
export type ObservationQuality = "exact" | "estimated" | "derived";

export const QUALITY_WEIGHT: Record<ObservationQuality, number> = {
  exact: 1,
  estimated: 0.5,
  derived: 0.25,
};

export interface EstimatorOptions {
  /** runtime.estimator.correctionGain (ratio per observation). */
  correctionGain: number;
  /** runtime.estimator.maxSlewBeatsPerSec: ceiling on the correction rate. */
  maxSlewBeatsPerSec: number;
  /** runtime.seek.thresholdBeats. */
  seekThresholdBeats: number;
  /** runtime.seek.thresholdMs. */
  seekThresholdMs: number;
}

export const ESTIMATOR_DEFAULTS: EstimatorOptions = {
  correctionGain: 0.15,
  maxSlewBeatsPerSec: 0.08,
  seekThresholdBeats: 0.5,
  seekThresholdMs: 150,
};

export interface BeatObservation {
  /** Observed position, in beats, through the deck's beat grid. */
  beat: number;
  nowNs: bigint;
  quality: ObservationQuality;
  playing: boolean;
  /** Deck tempo in beats per second (playRate * effectiveBpm / 60). */
  beatsPerSecond: number;
}

export interface EstimateResult {
  /** The estimate after this observation, in beats. */
  beat: number;
  /** True when the error was large enough to be a transport event (seek). */
  seeked: boolean;
  /** Phase correction applied by this observation, in beats. */
  corrected: number;
  /** Absolute error before the correction, in milliseconds of source time. */
  errorMs: number;
}

const MS_PER_SECOND = 1000;
const NS_PER_SECOND = 1e9;

// The phase correction is applied as a rate adjustment, not a step: while
// playing the beat is therefore monotonically non-decreasing by construction,
// and jitter on the observations is averaged out instead of being absorbed.
export class BeatEstimator {
  private beat: number;
  private lastNs: bigint | null = null;
  private playing = false;
  private rate = 0;

  constructor(startBeat = 0, private readonly opts: EstimatorOptions = ESTIMATOR_DEFAULTS) {
    this.beat = startBeat;
  }

  get current(): number {
    return this.beat;
  }

  get beatsPerSecond(): number {
    return this.rate;
  }

  /** Extrapolate the internal clock to nowNs at the last observed rate. */
  advance(nowNs: bigint): number {
    const dt = this.lastNs === null ? 0 : Math.max(0, Number(nowNs - this.lastNs) / NS_PER_SECOND);
    this.lastNs = nowNs;
    if (this.playing && dt > 0) this.beat += dt * this.rate;
    return this.beat;
  }

  /** Hard reset: a seek is random access, never a correction (T-RUN-03). */
  reset(beat: number, nowNs: bigint | null = null): void {
    this.beat = beat;
    if (nowNs !== null) this.lastNs = nowNs;
  }

  observe(obs: BeatObservation): EstimateResult {
    const previousNs = this.lastNs;
    if (previousNs === null) {
      // Cold start is random access: adopt the first observation outright.
      this.beat = obs.beat;
      this.lastNs = obs.nowNs;
      this.rate = obs.beatsPerSecond;
      this.playing = obs.playing;
      return { beat: this.beat, seeked: false, corrected: 0, errorMs: 0 };
    }
    const before = this.advance(obs.nowNs);
    const interval = Math.max(0, Number(obs.nowNs - previousNs) / NS_PER_SECOND);
    const errorBeats = obs.beat - before;
    const errorMs = obs.beatsPerSecond > 0
      ? (Math.abs(errorBeats) / obs.beatsPerSecond) * MS_PER_SECOND
      : Number.POSITIVE_INFINITY;
    const seek =
      Math.abs(errorBeats) > this.opts.seekThresholdBeats || errorMs > this.opts.seekThresholdMs;
    if (seek) {
      this.beat = obs.beat;
      this.rate = obs.beatsPerSecond;
      this.playing = obs.playing;
      return { beat: this.beat, seeked: true, corrected: obs.beat - before, errorMs };
    }
    const weight = QUALITY_WEIGHT[obs.quality];
    const slewCap = this.opts.maxSlewBeatsPerSec * interval;
    // advance() already moved the beat by the previous rate; the correction is
    // a phase term on top of that, never a second advance.
    let correction = interval === 0 ? 0 : errorBeats * this.opts.correctionGain * weight;
    if (slewCap > 0 && Math.abs(correction) > slewCap) correction = Math.sign(correction) * slewCap;
    // While playing forward the net movement stays non-negative as long as the
    // correction never exceeds the advance it is correcting.
    if (obs.playing && this.rate >= 0) correction = Math.max(correction, -this.rate * interval);
    this.beat = before + correction;
    this.rate = obs.beatsPerSecond;
    this.playing = obs.playing;
    return { beat: this.beat, seeked: false, corrected: correction, errorMs };
  }
}

// State estimator (§57): P + (now - T) * R while playing, in source seconds.
export function estimatePosition(obs: DeckState, nowNs: bigint): number {
  if (!obs.playing) return obs.playheadSeconds;
  const dt = Number(nowNs - obs.receivedAtNs) / NS_PER_SECOND;
  return obs.playheadSeconds + Math.max(0, dt) * obs.playRate;
}

// Seek detection (§58): predicted vs observed beyond threshold.
export function isSeek(predictedSeconds: number, observedSeconds: number, thresholdSeconds = 0.25): boolean {
  return Math.abs(predictedSeconds - observedSeconds) > thresholdSeconds;
}

// Seek detection in beat space (§58, T-RUN-03): beats are the unit here, and
// the millisecond threshold is converted through the deck's current tempo.
export function exceedsSeekThreshold(
  predictedBeat: number,
  observedBeat: number,
  beatsPerSecond: number,
  thresholds: { beats: number; ms: number } = {
    beats: ESTIMATOR_DEFAULTS.seekThresholdBeats,
    ms: ESTIMATOR_DEFAULTS.seekThresholdMs,
  },
): boolean {
  const errorBeats = Math.abs(observedBeat - predictedBeat);
  if (errorBeats > thresholds.beats * (1 + 1e-9)) return true;
  if (!(beatsPerSecond > 0)) return false;
  // Float arithmetic can push an exact-boundary value (0.3 beats at 2 beats/s
  // is exactly 150 ms) a few ulps over the threshold, which would flip a
  // smooth correction into a hard seek reset. The epsilon keeps the boundary
  // inclusive as specified.
  return (errorBeats / beatsPerSecond) * MS_PER_SECOND > thresholds.ms * (1 + 1e-9);
}

// Provider priority (§7): Lighting → Composite FLX4 → adaptive fallback.
export const PROVIDER_ORDER = ["lighting", "composite-flx4", "adaptive"] as const;
export type ProviderId = (typeof PROVIDER_ORDER)[number];

// ---------------------------------------------------------------------------
// Audible weight (§63, T-MIX-01)

export type CrossfaderSide = "A" | "B" | "THRU";
export type CrossfaderCurve = "source" | "linear" | "constant-power" | "sharp-cut";
/** DS-26: where the crossfader curve and position come from. */
export type CrossfaderSource = "software" | "controller" | "configured";

/** mixer.crossfader.assignment: deck id → side of the crossfader. */
export const DEFAULT_ASSIGNMENT: Record<string, CrossfaderSide> = { "1": "A", "2": "B", "3": "THRU", "4": "THRU" };

export interface CrossfaderConfig {
  assignment: Record<string, CrossfaderSide>;
  /** mixer.crossfader.curve. */
  curve: CrossfaderCurve;
  /** DS-26 choice; `auto` resolves software, then controller, then configured. */
  source: CrossfaderSource | "auto";
}

export const DEFAULT_CROSSFADER: CrossfaderConfig = {
  assignment: DEFAULT_ASSIGNMENT,
  curve: "source",
  source: "auto",
};

export function sideOf(deckId: number, assignment: Record<string, CrossfaderSide> = DEFAULT_ASSIGNMENT): CrossfaderSide {
  return assignment[String(deckId)] ?? "THRU";
}

// Curve shapes. `source` means the DJ software already applied its own curve,
// so the position arrives post-crossfader and is used as the gain (linear).
export function crossfaderGain(position: number, side: CrossfaderSide, curve: CrossfaderCurve = "linear"): number {
  if (side === "THRU") return 1;
  const p = Math.min(1, Math.max(0, position));
  if (curve === "sharp-cut") return side === "A" ? (p < 0.5 ? 1 : 0) : (p >= 0.5 ? 1 : 0);
  if (curve === "constant-power") {
    const angle = (p * Math.PI) / 2;
    return side === "A" ? Math.cos(angle) : Math.sin(angle);
  }
  return side === "A" ? 1 - p : p;
}

export interface WeightOptions {
  /** Shared crossfader position (0 = hard left, 1 = hard right). */
  position?: number;
  /** mixer.weight.masterBonus. */
  masterBonus?: number;
  crossfader?: Partial<CrossfaderConfig>;
}

// mixer.weight.masterBonus default.
export const DEFAULT_MASTER_BONUS = 0.1;

// Weight per deck from channel fader, crossfader position through assignment
// and curve, playing state, and master status (spec 63).
export function deckWeight(state: DeckState, position: number, opts: WeightOptions = {}): number {
  if (!state.playing || !state.track) return 0;
  const cfg = { ...DEFAULT_CROSSFADER, ...opts.crossfader };
  const side = sideOf(state.deckId, cfg.assignment);
  const gain = crossfaderGain(position, side, cfg.curve);
  const channel = state.channelFader ?? 1;
  const bonus = opts.masterBonus ?? DEFAULT_MASTER_BONUS;
  const masterFactor = state.master === true ? 1 + bonus : 1;
  return Math.min(1, Math.max(0, channel * gain * masterFactor));
}

// Weight from the deck's own reading. Without an explicit shared position the
// deck's own crossfader field is the DS-26 `software` value (post-crossfader),
// so both decks stay audible at centre.
export function audibleWeight(state: DeckState, opts: WeightOptions = {}): number {
  if (opts.position !== undefined) return deckWeight(state, opts.position, opts);
  if (!state.playing || !state.track) return 0;
  const channel = state.channelFader ?? 1;
  const crossfader = state.crossfader ?? 1;
  const bonus = opts.masterBonus ?? DEFAULT_MASTER_BONUS;
  const masterFactor = state.master === true ? 1 + bonus : 1;
  return Math.min(1, Math.max(0, channel * crossfader * masterFactor));
}

export interface CrossfaderReadings {
  software?: number | null;
  controller?: number | null;
  configured?: number | null;
}

export interface ResolvedCrossfader {
  position: number;
  source: CrossfaderSource;
  /** True when the requested source was missing and a later one was used. */
  fellBack: boolean;
  /** Range between the provided readings: the DS-26 agreement measurement. */
  spread: number | null;
}

// DS-26: software, then controller, then configured; `auto` is the combined
// mode and reports which rung supplied the value.
export function resolveCrossfader(
  mode: CrossfaderSource | "auto",
  readings: CrossfaderReadings,
  fallbackPosition = 0.5,
): ResolvedCrossfader {
  const provided: number[] = [];
  for (const value of [readings.software, readings.controller, readings.configured]) {
    if (typeof value === "number" && Number.isFinite(value)) provided.push(value);
  }
  const spread = provided.length > 1 ? Math.max(...provided) - Math.min(...provided) : null;
  const order: CrossfaderSource[] = mode === "auto" ? ["software", "controller", "configured"] : [mode];
  for (const source of order) {
    const value = readings[source];
    if (typeof value === "number" && Number.isFinite(value)) {
      return { position: Math.min(1, Math.max(0, value)), source, fellBack: false, spread };
    }
  }
  const first = order[0]!;
  return { position: fallbackPosition, source: first, fellBack: true, spread };
}

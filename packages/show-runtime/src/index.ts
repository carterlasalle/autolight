import {
  sourceSecondsToBeat,
  type DeckState,
  type ShowCue,
  type ShowPlan,
  type TrackModel,
} from "@autolight/contracts";
import {
  BeatEstimator,
  ESTIMATOR_DEFAULTS,
  exceedsSeekThreshold,
  estimatePosition,
  type BeatObservation,
  type EstimateResult,
  type EstimatorOptions,
  type ObservationQuality,
} from "@autolight/dj-core";

export type { DeckState, ShowCue, ShowPlan, TrackModel };
export { estimatePosition };

// Show runtime (T-RUN-01 to T-RUN-07).
//
// Everything here runs in the show host, never in React. The fixed tick order
// is: ingest, estimate, per-deck evaluation, director, mixer, overrides,
// render, output handoff, metrics, snapshot (at `runtime.snapshot.uiRateHz`).
// This module owns the ingest, estimate, evaluate and override stages; the
// director, mixer, renderer and output handoff live in their own packages.

export const DEFAULT_BPM = 120;
export const MAX_DECKS = 4;
const NS_PER_MS = 1e6;

// ---------------------------------------------------------------------------
// Cursor and plan evaluation (spec 58: random access, never a replay)

export interface CursorState {
  beat: number;
  loopPass: number;
  scratchHold: boolean;
}

export function evaluateCues(plan: ShowPlan, beat: number): ShowCue[] {
  return plan.cues
    .filter((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats)
    .sort((a, b) => b.priority - a.priority);
}

// The UI's "upcoming cues" come from the show host snapshot, computed per deck
// with that deck's own beat and the cues' real durations, intensities and
// priorities (T-MIX-06).
export function upcomingCues(plan: ShowPlan, beat: number, count = 8): ShowCue[] {
  return plan.cues
    .filter((c) => c.startBeat > beat)
    .sort((a, b) => a.startBeat - b.startBeat || b.priority - a.priority)
    .slice(0, Math.max(0, count));
}

// Map a looped source beat back into [loopStart, loopEnd), counting passes.
// Pass parity drives deterministic traversal variation (spec 59): A/B/A...
export function loopBeat(beat: number, loopStart: number, loopEnd: number): { beat: number; pass: number } {
  const len = loopEnd - loopStart;
  if (!(len > 0) || beat < loopStart) return { beat, pass: 0 };
  const pass = Math.floor((beat - loopStart) / len);
  return { beat: loopStart + ((beat - loopStart) % len), pass };
}

// ---------------------------------------------------------------------------
// Loops, rolls and pass variation (T-RUN-04, spec 59, 60)

export type LoopVariation = "none" | "alternate-ab" | "rotate-3";
export type RollDegrade = "full" | "pulse" | "contraction" | "impact";

/** runtime.loop.variation default. */
export const DEFAULT_LOOP_VARIATION: LoopVariation = "alternate-ab";
/** runtime.roll.degradeOrder default: brightness pulse, spatial contraction,
 * single impact, in that order (spec 60). */
export const DEFAULT_DEGRADE_ORDER: readonly RollDegrade[] = ["pulse", "contraction", "impact"];
/** Samples the fixture must manage per roll toggle to show it un-degraded. */
const SAMPLES_PER_TOGGLE = 3;

// Deterministic variant index per pass: none is always 0, alternate-ab flips
// between two, rotate-3 cycles through three.
export function loopPassVariant(pass: number, mode: LoopVariation = DEFAULT_LOOP_VARIATION): number {
  const p = Math.max(0, Math.floor(pass));
  if (mode === "none") return 0;
  if (mode === "rotate-3") return p % 3;
  return p % 2;
}

const MIRROR_TARGET: Record<string, string> = {
  PRIMARY: "SECONDARY",
  SECONDARY: "PRIMARY",
  LEFT: "RIGHT",
  RIGHT: "LEFT",
};

// Pass variation is visible in the frame but keeps the section's visual
// identity: the cue type and start beat, and therefore its palette reference
// and motif id, are untouched on every pass.
export function varyCueForPass(cue: ShowCue, variant: number): ShowCue {
  if (variant <= 0) return cue;
  const mirrored = MIRROR_TARGET[cue.target];
  const target = mirrored ?? cue.target;
  if (variant === 1) return target === cue.target ? cue : { ...cue, target };
  const intensity = Math.min(1, Math.max(0, (Math.round(cue.intensity * 100) / 100) * 0.85));
  return { ...cue, target, intensity };
}

// A fixture can show a roll only when it samples every toggle (spec 60's
// qualified rate). Otherwise the fixture degrades along
// `runtime.roll.degradeOrder` instead of strobing irregularly.
export function rollDegradeChoice(opts: {
  rollBeats: number;
  bpm: number;
  fixtureFps: number;
  order?: readonly RollDegrade[];
}): RollDegrade {
  const order = opts.order ?? DEFAULT_DEGRADE_ORDER;
  const toggleHz = opts.bpm > 0 && opts.rollBeats > 0 ? opts.bpm / 60 / opts.rollBeats : 0;
  if (!(toggleHz > 0) || opts.fixtureFps >= toggleHz * SAMPLES_PER_TOGGLE) return "full";
  return order[0] ?? "pulse";
}

// ---------------------------------------------------------------------------
// Reverse and scratch (T-RUN-05, spec 61)

export type OverrideKind = "none" | "blackout" | "white" | "freeze" | "force-low" | "force-high";
export type ResumeAt = "beat" | "bar" | "phrase" | "immediate";

export interface ScratchOptions {
  /** runtime.scratch.rateDeviation. */
  rateDeviation: number;
  /** runtime.scratch.minReversalsPerSec. */
  minReversalsPerSec: number;
  /** runtime.scratch.resyncAt. */
  resyncAt: ResumeAt;
}

export const SCRATCH_DEFAULTS: ScratchOptions = { rateDeviation: 0.5, minReversalsPerSec: 2, resyncAt: "bar" };
const REVERSAL_WINDOW_SECONDS = 1;
/** While the look is held, a jog may drift it by at most this many beats. */
const SCRATCH_MODULATION_BEATS = 0.25;
const SCRATCH_MODULATION_GAIN = 0.25;

export interface ScratchState {
  holding: boolean;
  /** Recent direction reversals, as observation timestamps in ns. */
  reversals: bigint[];
  /** The held look position while scratching. */
  heldBeat: number;
  /** The boundary the cursor resyncs at once forward playback is stable. */
  resyncBeat: number | null;
  lastRate: number;
}

export function initialScratchState(beat = 0): ScratchState {
  return { holding: false, reversals: [], heldBeat: beat, resyncBeat: null, lastRate: 1 };
}

export function recentReversals(scratch: ScratchState, nowNs: bigint): number {
  const windowNs = BigInt(Math.round(REVERSAL_WINDOW_SECONDS * 1e9));
  return scratch.reversals.filter((ns) => nowNs - ns <= windowNs).length;
}

// Scratch is detected from rate deviation and reversals; FLX4 jog hints are
// another input to the same state, folded in by the caller. A steady reverse
// rate with no reversals is a reverse effect, which follows the timeline
// backward instead of holding (spec 61).
export function scratchDetected(
  state: DeckState,
  scratch: ScratchState,
  opts: ScratchOptions = SCRATCH_DEFAULTS,
): boolean {
  const reversals = recentReversals(scratch, state.receivedAtNs);
  if (state.playing && state.playRate >= 0 && Math.abs(state.playRate - 1) > opts.rateDeviation) return true;
  return reversals >= opts.minReversalsPerSec;
}

export function observeRate(scratch: ScratchState, state: DeckState): ScratchState {
  const previous = scratch.lastRate;
  const reversed = Math.sign(state.playRate) !== Math.sign(previous) && previous !== 0 && state.playRate !== 0;
  const reversals = reversed ? [...scratch.reversals, state.receivedAtNs] : scratch.reversals;
  return { ...scratch, reversals, lastRate: state.playRate };
}

// ---------------------------------------------------------------------------
// Manual overrides (T-RUN-07, spec 134)

/** runtime.override.resumeDefault. */
export const DEFAULT_RESUME_AT: ResumeAt = "bar";
/** runtime.override.whiteIntensity. */
export const DEFAULT_WHITE_INTENSITY = 1;

export interface ResumeGrid {
  /** Native grid beat indices. */
  beats: number[];
  /** Native downbeats (`beatInBar === 1`), never multiples of 4. */
  barBeats: number[];
  /** Fused or PSSI phrase starts, never multiples of 16. */
  phraseBeats: number[];
}

export function resumeGridFromModel(model: TrackModel | null): ResumeGrid {
  if (model === null) return { beats: [], barBeats: [], phraseBeats: [] };
  return {
    beats: model.beatGrid.beats.map((b) => b.index),
    barBeats: model.beatGrid.beats.filter((b) => b.beatInBar === 1).map((b) => b.index),
    phraseBeats: model.sections.map((s) => s.startBeat),
  };
}

function nextBoundary(beat: number, boundaries: number[]): number | null {
  let best: number | null = null;
  for (const b of boundaries) {
    if (b >= beat && (best === null || b < best)) best = b;
  }
  return best;
}

// Quantized resume: beat and bar boundaries come from the native grid and
// phrase boundaries from fused or PSSI phrases, never from multiples of 4 and
// 16. `immediate` is really immediate, not rounded up (spec 134).
export function quantizeResume(beat: number, at: ResumeAt, grid?: ResumeGrid | null): number {
  if (at === "immediate") return beat;
  if (grid !== undefined && grid !== null) {
    const boundaries = at === "beat" ? grid.beats : at === "bar" ? grid.barBeats : grid.phraseBeats;
    const next = nextBoundary(beat, boundaries);
    if (next !== null) return next;
  }
  if (at === "beat") return Math.ceil(beat);
  if (at === "bar") return Math.ceil(beat / 4) * 4;
  return Math.ceil(beat / 16) * 16;
}

export interface OverrideState {
  kind: OverrideKind;
  resumeAt: ResumeAt;
  /** Beat automation resumes at; null while an override is engaged. */
  resumeBeat: number | null;
  pendingResume: boolean;
  whiteIntensity: number;
}

export function initialOverrideState(): OverrideState {
  return {
    kind: "none",
    resumeAt: DEFAULT_RESUME_AT,
    resumeBeat: null,
    pendingResume: false,
    whiteIntensity: DEFAULT_WHITE_INTENSITY,
  };
}

export interface OverrideEffect {
  kind: OverrideKind;
  /** Multiplier applied in the renderer's master layer. */
  factor: number;
  /** Hold the last rendered look and keep the clock running. */
  hold: boolean;
  /** White output at this intensity: RGB white, never kelvin (spec 48). */
  white: number | null;
  /** Forced energy tier, or null to keep automation. */
  energy: number | null;
}

const FORCE_ENERGY: Record<string, number> = { "force-low": 0.25, "force-high": 1 };

export function overrideEffect(state: OverrideState, masterIntensity = 1): OverrideEffect {
  const master = Math.min(1, Math.max(0, masterIntensity));
  switch (state.kind) {
    case "blackout":
      return { kind: state.kind, factor: 0, hold: false, white: null, energy: null };
    case "white":
      return {
        kind: state.kind,
        factor: master,
        hold: false,
        white: Math.min(1, Math.max(0, state.whiteIntensity * master)),
        energy: null,
      };
    case "freeze":
      return { kind: state.kind, factor: master, hold: true, white: null, energy: null };
    case "force-low":
    case "force-high":
      return { kind: state.kind, factor: master, hold: false, white: null, energy: FORCE_ENERGY[state.kind] ?? null };
    default:
      return { kind: "none", factor: master, hold: false, white: null, energy: null };
  }
}

// Engage an override. Emergency kinds (blackout, white, freeze) take effect in
// the tick they are received: no queue and no rounding. Resuming automation
// quantizes to the requested boundary.
export function setOverride(
  prev: OverrideState,
  kind: OverrideKind,
  opts: { beat: number; at?: ResumeAt; grid?: ResumeGrid | null; whiteIntensity?: number },
): OverrideState {
  const whiteIntensity = opts.whiteIntensity ?? prev.whiteIntensity;
  if (kind !== "none") {
    return { ...prev, kind, whiteIntensity, resumeBeat: null, pendingResume: false };
  }
  const at = opts.at ?? DEFAULT_RESUME_AT;
  const resumeBeat = quantizeResume(opts.beat, at, opts.grid ?? null);
  return { ...prev, kind: "none", resumeAt: at, whiteIntensity, resumeBeat, pendingResume: resumeBeat > opts.beat };
}

// Advance the override state machine against the cursor.
export function advanceOverride(state: OverrideState, beat: number): { state: OverrideState; resumed: boolean } {
  if (!state.pendingResume || state.resumeBeat === null || beat < state.resumeBeat) {
    return { state, resumed: false };
  }
  return { state: { ...state, pendingResume: false, resumeBeat: null, kind: "none" }, resumed: true };
}

// ---------------------------------------------------------------------------
// Clock health and the adaptive fallback clock (T-RUN-06, spec 105, DS-23)

export type ClockHealth = "live" | "extrapolating" | "holding" | "degraded";

/** runtime.health.extrapolateMs / runtime.health.holdMs. */
export const HEALTH_EXTRAPOLATE_MS = 500;
export const HEALTH_HOLD_MS = 2000;

export function clockHealth(
  msSinceLastUpdate: number,
  thresholds: { extrapolateMs: number; holdMs: number } = {
    extrapolateMs: HEALTH_EXTRAPOLATE_MS,
    holdMs: HEALTH_HOLD_MS,
  },
): ClockHealth {
  if (msSinceLastUpdate <= 0) return "live";
  if (msSinceLastUpdate <= thresholds.extrapolateMs) return "extrapolating";
  if (msSinceLastUpdate <= thresholds.holdMs) return "holding";
  return "degraded";
}

/** Motion floor while the clock holds or runs on the adaptive clock. */
export const HOLD_MOTION_FLOOR = 0.25;

// Motion factor for the director and the renderer: full while the provider
// clock is live or extrapolating, faded while the estimate is held, and
// restrained on the adaptive clock (spec 105: hold the estimate, fade motion).
export function motionFactor(health: ClockHealth, msSinceLastUpdate: number): number {
  if (health === "live" || health === "extrapolating") return 1;
  const span = Math.max(1, HEALTH_HOLD_MS - HEALTH_EXTRAPOLATE_MS);
  const fade = Math.min(1, Math.max(0, (msSinceLastUpdate - HEALTH_EXTRAPOLATE_MS) / span));
  return 1 - (1 - HOLD_MOTION_FLOOR) * fade;
}

/** Where the beat of a tick came from (T-RUN-06). */
export type ClockSource = "provider" | "hold" | "adaptive";

export type AdaptiveClockMode = "dj-bpm" | "audio-onset" | "blend";

/** DS-23 default: blend of the DJ tempo and the live audio tempo. */
export const ADAPTIVE_CLOCK_DEFAULT: AdaptiveClockMode = "blend";

export interface AdaptiveClockInputs {
  /** Last known DJ tempo and phase (`dj-bpm`). */
  djBpm: number | null;
  djBeat: number | null;
  djAnchorNs: bigint | null;
  /** Live tempo from the onset detector (`audio-onset`, T-AUD-02). */
  audioBpm: number | null;
  audioBeat: number | null;
  audioAnchorNs: bigint | null;
  /** 0 to 1 confidence from the tempo estimate; weights the blend. */
  audioConfidence: number;
}

export interface AdaptiveBeat {
  beat: number;
  /** The tempo this beat advances at, in BPM. */
  bpm: number;
  source: AdaptiveClockMode;
}

// The adaptive clock extrapolates a phase anchor at a tempo. `dj-bpm` uses the
// last known provider tempo and phase, `audio-onset` the live tempo from the
// DSP, and `blend` (default) weights the two tempos by the audio confidence
// while keeping the provider's phase, so the show never restarts from an
// unknown origin.
export function adaptiveBeat(
  inputs: AdaptiveClockInputs,
  nowNs: bigint,
  mode: AdaptiveClockMode = ADAPTIVE_CLOCK_DEFAULT,
): AdaptiveBeat | null {
  const elapsedSeconds = (anchorNs: bigint | null): number =>
    anchorNs === null ? 0 : Math.max(0, Number(nowNs - anchorNs) / 1e9);
  const atTempo = (beat: number | null, bpm: number | null, anchorNs: bigint | null): number | null =>
    beat === null || bpm === null || bpm <= 0 || anchorNs === null ? null : beat + elapsedSeconds(anchorNs) * (bpm / 60);
  const dj = atTempo(inputs.djBeat, inputs.djBpm, inputs.djAnchorNs);
  const audio = atTempo(inputs.audioBeat, inputs.audioBpm, inputs.audioAnchorNs);
  if (mode === "dj-bpm") {
    return dj === null || inputs.djBpm === null ? null : { beat: dj, bpm: inputs.djBpm, source: "dj-bpm" };
  }
  if (mode === "audio-onset") {
    if (audio !== null && inputs.audioBpm !== null) return { beat: audio, bpm: inputs.audioBpm, source: "audio-onset" };
    // Without an audio phase, follow the provider phase at the live tempo.
    const fromDjPhase = atTempo(inputs.djBeat, inputs.audioBpm, inputs.djAnchorNs);
    if (fromDjPhase === null || inputs.audioBpm === null) return null;
    return { beat: fromDjPhase, bpm: inputs.audioBpm, source: "audio-onset" };
  }
  const audioWeight = Math.min(1, Math.max(0, inputs.audioConfidence));
  if (inputs.djBpm !== null && inputs.audioBpm !== null && inputs.audioBpm > 0 && audioWeight > 0) {
    const bpm = (inputs.djBpm + inputs.audioBpm * audioWeight) / (1 + audioWeight);
    const blended = atTempo(inputs.djBeat, bpm, inputs.djAnchorNs);
    if (blended !== null) return { beat: blended, bpm, source: "blend" };
    if (audio !== null) return { beat: audio, bpm, source: "blend" };
  }
  if (dj !== null && inputs.djBpm !== null) return { beat: dj, bpm: inputs.djBpm, source: "dj-bpm" };
  if (audio !== null && inputs.audioBpm !== null) return { beat: audio, bpm: inputs.audioBpm, source: "audio-onset" };
  return null;
}

/** Live tempo handed to the runtime by the DSP (T-AUD-02, DS-23). */
export interface AudioTempo {
  bpm: number;
  /** 0 to 1 confidence from the tempo estimate. */
  confidence: number;
  /** Phase anchor in beats, valid at anchorNs; null when the phase is unknown. */
  beat: number | null;
  anchorNs: bigint | null;
}

export function setAudioTempo(world: DeckWorld, tempo: AudioTempo | null): void {
  world.audioTempo = tempo;
}

function adaptiveInputsOf(world: DeckWorld): AdaptiveClockInputs {
  const known = world.lastKnown;
  const tempo = world.audioTempo;
  return {
    djBpm: known === null ? null : known.beatsPerSecond * 60,
    djBeat: known?.beat ?? null,
    djAnchorNs: known?.anchorNs ?? null,
    audioBpm: tempo?.bpm ?? null,
    audioBeat: tempo?.beat ?? null,
    audioAnchorNs: tempo?.anchorNs ?? null,
    audioConfidence: tempo?.confidence ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Device faults (T-RUN-06, spec 107): the runtime receives per-device effective
// capability and FPS from the govee-manager (T-GOV-06, T-GOV-08) and keeps the
// logical tick for every other device. A faulted device drops out on its own.

export const LOGICAL_TICK_HZ = 60;

export interface DeviceRuntimeState {
  deviceId: string;
  /** Effective transport capability after the manager's fallback. */
  capability: "segmented" | "single-zone";
  /** Effective frames per second the manager qualified for this device. */
  fps: number;
  /** False while the device is offline (fault) or hard-unavailable. */
  online: boolean;
}

/** True when this logical tick produces a frame for the device. */
export function deviceFrameDue(device: DeviceRuntimeState, tickIndex: number, logicalHz = LOGICAL_TICK_HZ): boolean {
  if (!device.online || !(device.fps > 0) || tickIndex < 0 || logicalHz <= 0) return false;
  const before = Math.floor((tickIndex * device.fps) / logicalHz);
  const after = Math.floor(((tickIndex + 1) * device.fps) / logicalHz);
  return after > before;
}

/** The devices due on this tick; each keeps its own effective FPS. */
export function dueDevicesOnTick(
  devices: readonly DeviceRuntimeState[],
  tickIndex: number,
  logicalHz = LOGICAL_TICK_HZ,
): DeviceRuntimeState[] {
  return devices.filter((device) => deviceFrameDue(device, tickIndex, logicalHz));
}

// ---------------------------------------------------------------------------
// Deck worlds (T-RUN-01, spec 62)

export interface DeckTick {
  deckId: number;
  generation: number;
  beat: number;
  loopPass: number;
  scratchHold: boolean;
  seeked: boolean;
  /** In-flight exclusive cues at this beat. */
  transients: ShowCue[];
  cues: ShowCue[];
  upcoming: ShowCue[];
  clockHealth: ClockHealth;
  /** Which clock produced this beat (T-RUN-06). */
  clockSource: ClockSource;
  /** Motion factor for the director/renderer; fades while the clock holds. */
  motion: number;
}

export interface DeckWorld {
  readonly deckId: number;
  readonly estimatorOptions: EstimatorOptions;
  readonly scratchOptions: ScratchOptions;
  generation: number;
  /** Newest DeckState only: ingest never queues and never blocks. */
  state: DeckState | null;
  model: TrackModel | null;
  plan: ShowPlan | null;
  cursor: CursorState;
  estimator: BeatEstimator;
  scratch: ScratchState;
  /** In-flight exclusive cues at the current beat. */
  transients: ShowCue[];
  /** Transients of the abandoned location dropped by the last seek. */
  cancelled: ShowCue[];
  override: OverrideState;
  quality: ObservationQuality;
  /** T-RUN-06: last fresh provider tempo and phase, for the adaptive clock. */
  lastKnown: { beatsPerSecond: number; beat: number; anchorNs: bigint } | null;
  /** T-RUN-06: the beat frozen when the clock entered `holding`. */
  holdBeat: number | null;
  /** DS-23 mode for the degraded fallback clock. */
  adaptiveMode: AdaptiveClockMode;
  /** T-AUD-02 live tempo, set by the show host when features arrive. */
  audioTempo: AudioTempo | null;
}

export interface DeckWorldOptions {
  generation?: number;
  startBeat?: number;
  estimator?: Partial<EstimatorOptions>;
  scratch?: Partial<ScratchOptions>;
  quality?: ObservationQuality;
  adaptiveMode?: AdaptiveClockMode;
}

export function createDeckWorld(deckId: number, opts: DeckWorldOptions = {}): DeckWorld {
  const estimatorOptions: EstimatorOptions = { ...ESTIMATOR_DEFAULTS, ...opts.estimator };
  return {
    deckId,
    estimatorOptions,
    scratchOptions: { ...SCRATCH_DEFAULTS, ...opts.scratch },
    generation: opts.generation ?? 0,
    state: null,
    model: null,
    plan: null,
    cursor: { beat: opts.startBeat ?? 0, loopPass: 0, scratchHold: false },
    estimator: new BeatEstimator(opts.startBeat ?? 0, estimatorOptions),
    scratch: initialScratchState(opts.startBeat ?? 0),
    transients: [],
    cancelled: [],
    override: initialOverrideState(),
    quality: opts.quality ?? "estimated",
    lastKnown: null,
    holdBeat: null,
    adaptiveMode: opts.adaptiveMode ?? ADAPTIVE_CLOCK_DEFAULT,
    audioTempo: null,
  };
}

// Latest wins: an older observation is dropped, a newer one replaces the
// current state outright.
export function ingestDeck(world: DeckWorld, state: DeckState, quality?: ObservationQuality): boolean {
  if (world.state !== null && state.receivedAtNs < world.state.receivedAtNs) return false;
  world.state = state;
  if (quality !== undefined) world.quality = quality;
  return true;
}

export function installPlan(world: DeckWorld, generation: number, plan: ShowPlan | null): void {
  world.plan = plan;
  world.generation = generation;
}

export function installModel(world: DeckWorld, generation: number, model: TrackModel | null): void {
  world.model = model;
  world.generation = generation;
}

export function beatsPerSecondOf(state: DeckState): number {
  return (state.effectiveBpm ?? DEFAULT_BPM) / 60;
}

export function gridBeatOf(world: DeckWorld, seconds: number): number {
  if (world.model !== null) return sourceSecondsToBeat(world.model.beatGrid, seconds);
  return seconds * (world.state?.effectiveBpm ?? DEFAULT_BPM) / 60;
}

// Seek is random access (spec 58): reset the interpolator, recompute the
// fractional beat, rebuild the plan state at that beat as a pure function of
// the plan, and cancel the transients of the abandoned location. No replay of
// prior cues, and the new state is available in the same tick.
export function seekWorld(
  world: DeckWorld,
  beat: number,
  nowNs: bigint | null = null,
): { cancelled: ShowCue[]; cues: ShowCue[] } {
  const cancelled = world.transients.filter(
    (t) => !(beat >= t.startBeat && beat < t.startBeat + t.durationBeats),
  );
  world.estimator.reset(beat, nowNs);
  world.cursor = { beat, loopPass: 0, scratchHold: world.cursor.scratchHold };
  world.scratch = { ...initialScratchState(beat), lastRate: world.scratch.lastRate };
  world.cancelled = cancelled;
  const cues = world.plan === null ? [] : evaluateCues(world.plan, beat);
  world.transients = exclusiveOf(cues);
  return { cancelled, cues };
}

const EXCLUSIVE_TYPES: Record<string, true> = { "white-hit": true, impact: true, strobe: true, blackout: true };

export function exclusiveOf(cues: ShowCue[]): ShowCue[] {
  return cues.filter((c) => EXCLUSIVE_TYPES[c.type] === true);
}

function loopWindow(world: DeckWorld, state: DeckState): { start: number; end: number } | null {
  const { startSeconds, endSeconds } = state.loop;
  if (!state.loop.active || startSeconds === null || endSeconds === null) return null;
  const start = gridBeatOf(world, startSeconds);
  const end = gridBeatOf(world, endSeconds);
  return end > start ? { start, end } : null;
}

export interface TickOptions {
  loopVariation?: LoopVariation;
}

// One deck's stage of the tick: ingest is separate, then estimate, seek, loop,
// scratch hold, evaluate, override.
export function tickWorld(world: DeckWorld, nowNs: bigint, opts: TickOptions = {}): DeckTick | null {
  const state = world.state;
  if (state === null) return null;
  const tempoBps = beatsPerSecondOf(state);
  const observed = gridBeatOf(world, state.playheadSeconds);
  const observation: BeatObservation = {
    beat: observed,
    nowNs,
    quality: world.quality,
    playing: state.playing,
    beatsPerSecond: state.playing ? tempoBps * state.playRate : 0,
  };
  const ageMs = nowNs >= state.receivedAtNs ? Number(nowNs - state.receivedAtNs) / NS_PER_MS : 0;
  const health = clockHealth(ageMs);

  // Source loss (T-RUN-06, spec 105). A fresh observation feeds the estimator;
  // one older than the seek threshold cannot be told apart from a transport
  // jump, so it only extrapolates. Past `runtime.health.extrapolateMs` the
  // estimate is held and motion fades; past `runtime.health.holdMs` the
  // adaptive clock (DS-23) takes over from the last known tempo and phase. A
  // dropped message never blanks the show by itself: every branch still
  // evaluates the plan at a beat.
  const fresh = ageMs <= world.estimatorOptions.seekThresholdMs;
  let estimated: EstimateResult;
  let adaptive: AdaptiveBeat | null = null;
  if (fresh) {
    estimated = world.estimator.observe(observation);
    world.lastKnown = { beatsPerSecond: observation.beatsPerSecond, beat: observed, anchorNs: state.receivedAtNs };
    world.holdBeat = null;
  } else {
    const extrapolated = world.estimator.advance(nowNs);
    if (health === "holding") {
      world.holdBeat = world.holdBeat ?? extrapolated;
      estimated = { beat: world.holdBeat, seeked: false, corrected: 0, errorMs: 0 };
    } else if (health === "degraded") {
      adaptive = adaptiveBeat(adaptiveInputsOf(world), nowNs, world.adaptiveMode);
      estimated = { beat: adaptive?.beat ?? extrapolated, seeked: false, corrected: 0, errorMs: 0 };
      world.holdBeat = null;
    } else {
      // Extrapolating on a stale observation: keep the last rate, no correction.
      estimated = { beat: extrapolated, seeked: false, corrected: 0, errorMs: 0 };
    }
  }
  const clockSource: ClockSource = adaptive !== null ? "adaptive" : health === "holding" ? "hold" : "provider";
  const motion = motionFactor(health, ageMs);

  world.scratch = observeRate(world.scratch, state);
  const scratching = scratchDetected(state, world.scratch, world.scratchOptions);

  // Scratch hold: keep the base look, resync at the next boundary once forward
  // playback is stable (spec 61). A jog that moves the deck does not move the
  // look, so a seek inside a scratch never jumps the whole design. Reverse
  // playback without scratch follows the timeline, which the estimator already
  // does with a negative rate.
  let beat = estimated.beat;
  if (scratching) {
    const base = world.scratch.holding ? world.scratch.heldBeat : world.cursor.beat;
    // Limited gesture modulation: the look drifts at most a quarter beat.
    const drift = Math.max(
      -SCRATCH_MODULATION_BEATS,
      Math.min(SCRATCH_MODULATION_BEATS, (observed - base) * SCRATCH_MODULATION_GAIN),
    );
    beat = base + drift;
    world.scratch = { ...world.scratch, holding: true, heldBeat: base, resyncBeat: null };
    if (estimated.seeked) world.cancelled = world.transients;
  } else if (world.scratch.holding) {
    // Leaving the hold: resync at the next boundary once forward playback is
    // stable, whatever the interpolator did in between.
    const resyncBeat = world.scratch.resyncBeat ?? quantizeResume(observed, world.scratchOptions.resyncAt, resumeGridFromModel(world.model));
    const stable = state.playRate > 0 && Math.abs(state.playRate - 1) <= world.scratchOptions.rateDeviation;
    if (stable && observed >= resyncBeat) {
      world.cancelled = world.transients;
      world.scratch = { ...world.scratch, holding: false, resyncBeat: null, heldBeat: observed };
      world.cursor = { beat: observed, loopPass: 0, scratchHold: false };
      world.transients = [];
      beat = observed;
    } else {
      beat = world.scratch.heldBeat;
      world.scratch = { ...world.scratch, resyncBeat };
    }
  } else if (estimated.seeked) {
    world.cancelled = world.transients;
    world.cursor = { beat: estimated.beat, loopPass: 0, scratchHold: false };
    world.transients = [];
  }

  // Loops: the region is evaluated repeatedly, and transients are recomputed
  // from the folded beat, so a hit at the loop start fires on every pass.
  let loopPass = world.cursor.loopPass;
  const window = loopWindow(world, state);
  if (window !== null && !world.scratch.holding) {
    const folded = loopBeat(beat, window.start, window.end);
    beat = folded.beat;
    loopPass = folded.pass;
  } else if (window === null) {
    loopPass = 0;
  }

  let cues = world.plan === null ? [] : evaluateCues(world.plan, beat);
  const variant = loopPassVariant(loopPass, opts.loopVariation ?? DEFAULT_LOOP_VARIATION);
  if (window !== null && variant > 0) cues = cues.map((c) => varyCueForPass(c, variant));
  world.transients = exclusiveOf(cues);
  world.cursor = { beat, loopPass, scratchHold: world.scratch.holding };
  world.override = advanceOverride(world.override, beat).state;
  return {
    deckId: world.deckId,
    generation: world.generation,
    beat,
    loopPass,
    scratchHold: world.scratch.holding,
    seeked: estimated.seeked,
    transients: world.transients,
    cues,
    upcoming: world.plan === null ? [] : upcomingCues(world.plan, beat, 8),
    clockHealth: health,
    clockSource,
    motion,
  };
}

// ---------------------------------------------------------------------------
// Show runtime: one world per deck (up to MAX_DECKS), one tick for all of them

export interface ShowRuntimeOptions {
  deckIds?: number[];
  world?: DeckWorldOptions;
}

export class ShowRuntime {
  private readonly worlds = new Map<number, DeckWorld>();
  private readonly options: DeckWorldOptions;

  constructor(opts: ShowRuntimeOptions = {}) {
    this.options = opts.world ?? {};
    for (const deckId of opts.deckIds ?? []) this.world(deckId);
  }

  world(deckId: number): DeckWorld {
    const existing = this.worlds.get(deckId);
    if (existing !== undefined) return existing;
    if (this.worlds.size >= MAX_DECKS) {
      throw new Error(`show runtime holds at most ${MAX_DECKS} deck worlds (spec 62)`);
    }
    const created = createDeckWorld(deckId, this.options);
    this.worlds.set(deckId, created);
    return created;
  }

  decks(): DeckWorld[] {
    return [...this.worlds.values()];
  }

  ingest(deckId: number, state: DeckState, quality?: ObservationQuality): boolean {
    return ingestDeck(this.world(deckId), state, quality);
  }

  installPlan(deckId: number, generation: number, plan: ShowPlan | null): void {
    installPlan(this.world(deckId), generation, plan);
  }

  installModel(deckId: number, generation: number, model: TrackModel | null): void {
    installModel(this.world(deckId), generation, model);
  }

  seek(deckId: number, beat: number, nowNs: bigint | null = null): { cancelled: ShowCue[]; cues: ShowCue[] } {
    return seekWorld(this.world(deckId), beat, nowNs);
  }

  setOverride(
    deckId: number,
    kind: OverrideKind,
    opts: { beat: number; at?: ResumeAt; grid?: ResumeGrid | null; whiteIntensity?: number },
  ): OverrideState {
    const world = this.world(deckId);
    world.override = setOverride(world.override, kind, opts);
    return world.override;
  }

  /** T-AUD-02 features feed the degraded clock (DS-23). */
  setAudioTempo(deckId: number, tempo: AudioTempo | null): void {
    setAudioTempo(this.world(deckId), tempo);
  }

  tick(nowNs: bigint, opts: TickOptions = {}): DeckTick[] {
    const ticks: DeckTick[] = [];
    for (const world of this.worlds.values()) {
      const tick = tickWorld(world, nowNs, opts);
      if (tick !== null) ticks.push(tick);
    }
    return ticks;
  }
}

// ---------------------------------------------------------------------------
// Compatibility helpers for callers that track a single deck by hand

export interface TrackDeckOptions {
  seekThresholdBeats?: number;
  seekThresholdMs?: number;
  beatsPerSecond?: number;
  scratch?: Partial<ScratchOptions>;
}

export interface TrackedDeck {
  beat: number;
  scratchHold: boolean;
  seeked: boolean;
}

// Track a deck observation: seek snap vs smooth follow vs scratch hold
// (spec 58, 61). The threshold is in beats; the millisecond variant is
// converted through the deck's tempo, never compared against beats directly.
export function trackDeck(
  prevBeat: number,
  obs: DeckState,
  gridBeat: (seconds: number) => number,
  opts: TrackDeckOptions = {},
): TrackedDeck {
  const observed = gridBeat(obs.playheadSeconds);
  const scratchOpts: ScratchOptions = { ...SCRATCH_DEFAULTS, ...opts.scratch };
  const scratch = observeRate(initialScratchState(prevBeat), obs);
  if (scratchDetected(obs, scratch, scratchOpts)) return { beat: prevBeat, scratchHold: true, seeked: false };
  const bps = opts.beatsPerSecond ?? beatsPerSecondOf(obs);
  const jumped = exceedsSeekThreshold(prevBeat, observed, bps, {
    beats: opts.seekThresholdBeats ?? ESTIMATOR_DEFAULTS.seekThresholdBeats,
    ms: opts.seekThresholdMs ?? ESTIMATOR_DEFAULTS.seekThresholdMs,
  });
  return { beat: observed, scratchHold: false, seeked: jumped };
}

export function cursorBeat(state: CursorState): number {
  return state.beat;
}

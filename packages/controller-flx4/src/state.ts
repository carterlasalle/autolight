// Controller state model (T-FLX-03, spec 10, spec 11).
//
// State is maintained from decoded events and exposed read-only. Anything the
// hardware reports directly (faders, knobs, pad presses, jog touch) is
// `observed`; anything inferred from button presses (play, sync, loop active,
// master) is `estimated` per spec 11: FLX4 telemetry is secondary truth and
// never overrides a DJ software playhead.
//
// Tempo mapping: `flx4.tempoRange` selects a fixed range (6, 10 or 16 percent)
// or `source`, which fits the fader travel to the pitch a DJ software provider
// reports. The fitted value is what Settings shows.

import {
  BEAT_LOOP_PAD_BEATS,
  type Flx4Deck,
  type Flx4Event,
  type Flx4PadMode,
  type Flx4ControlEvent,
} from "./map.js";

export type Flx4Quality = "observed" | "estimated";

export interface ButtonState {
  on: boolean;
  atNs: bigint | null;
  quality: Flx4Quality;
}

export type LoopAction = "in" | "out" | "halve" | "double" | "exit" | "reloop" | "beat-loop";

export interface LoopState {
  /** Last observed loop state; null until a loop control was touched. */
  active: boolean | null;
  lastAction: LoopAction | null;
  lastAtNs: bigint | null;
  /** Loop length in beats when the action carries it (beat-loop pads). */
  beatLength: number | null;
  quality: Flx4Quality;
}

export interface JogState {
  touched: boolean;
  /** Last jog delta, positive clockwise. */
  velocity: number;
  direction: -1 | 0 | 1;
  atNs: bigint | null;
  /** Timestamps of direction reversals while touched, newest last. */
  reversals: bigint[];
  /** True while a scratch is observed: touched and enough reversals. */
  scratchActive: boolean;
}

export interface DeckControllerState {
  deck: Flx4Deck;
  play: ButtonState;
  cue: ButtonState;
  shift: boolean;
  padMode: Flx4PadMode | null;
  padModeAtNs: bigint | null;
  /** Pad indices currently down, per mode. */
  padsDown: number[];
  loop: LoopState;
  sync: { enabled: boolean | null; master: boolean; atNs: bigint | null; quality: Flx4Quality };
  jog: JogState;
  tempo: { position: number; atNs: bigint } | null;
  channelFader: { position: number; atNs: bigint } | null;
  trim: number | null;
  eqHigh: number | null;
  eqMid: number | null;
  eqLow: number | null;
  cfx: number | null;
  loads: { count: number; lastAtNs: bigint | null };
}

export interface Flx4MixerState {
  crossfader: { position: number; atNs: bigint } | null;
  masterLevel: number | null;
  headMix: number | null;
  headLevel: number | null;
  headCue: { 1: boolean; 2: boolean };
  fxLevelDepth: number | null;
  smartCfx: boolean;
  smartFader: boolean;
}

export interface Flx4ControllerSnapshot {
  decks: Record<Flx4Deck, DeckControllerState>;
  mixer: Flx4MixerState;
  updatedAtNs: bigint | null;
  eventsApplied: number;
}

export interface StateModelOptions {
  nowNs?: () => bigint;
  /** runtime.scratch.minReversalsPerSec. */
  minReversalsPerSec?: number;
  /** Reversal window in seconds, matching the runtime's one-second window. */
  reversalWindowSeconds?: number;
}

/** Reversal window over which jog reversals count toward a scratch. */
export const DEFAULT_REVERSAL_WINDOW_SECONDS = 1;
/** runtime.scratch.minReversalsPerSec default (registry default 2). */
export const DEFAULT_MIN_REVERSALS_PER_SEC = 2;

const emptyDeck = (deck: Flx4Deck): DeckControllerState => ({
  deck,
  play: { on: false, atNs: null, quality: "estimated" },
  cue: { on: false, atNs: null, quality: "observed" },
  shift: false,
  padMode: null,
  padModeAtNs: null,
  padsDown: [],
  loop: { active: null, lastAction: null, lastAtNs: null, beatLength: null, quality: "estimated" },
  sync: { enabled: null, master: false, atNs: null, quality: "estimated" },
  jog: { touched: false, velocity: 0, direction: 0, atNs: null, reversals: [], scratchActive: false },
  tempo: null,
  channelFader: null,
  trim: null,
  eqHigh: null,
  eqMid: null,
  eqLow: null,
  cfx: null,
  loads: { count: 0, lastAtNs: null },
});

const emptyMixer = (): Flx4MixerState => ({
  crossfader: null,
  masterLevel: null,
  headMix: null,
  headLevel: null,
  headCue: { 1: false, 2: false },
  fxLevelDepth: null,
  smartCfx: false,
  smartFader: false,
});

const copyDeck = (deck: DeckControllerState): DeckControllerState => ({
  ...deck,
  play: { ...deck.play },
  cue: { ...deck.cue },
  loop: { ...deck.loop },
  sync: { ...deck.sync },
  jog: { ...deck.jog, reversals: [...deck.jog.reversals] },
  padsDown: [...deck.padsDown],
  tempo: deck.tempo === null ? null : { ...deck.tempo },
  channelFader: deck.channelFader === null ? null : { ...deck.channelFader },
  loads: { ...deck.loads },
});

const deepCopy = (snapshot: Flx4ControllerSnapshot): Flx4ControllerSnapshot => ({
  decks: { 1: copyDeck(snapshot.decks[1]), 2: copyDeck(snapshot.decks[2]) },
  mixer: { ...snapshot.mixer, headCue: { ...snapshot.mixer.headCue } },
  updatedAtNs: snapshot.updatedAtNs,
  eventsApplied: snapshot.eventsApplied,
});

export class Flx4StateModel {
  private readonly state: Flx4ControllerSnapshot;
  private readonly nowNs: () => bigint;
  private readonly minReversals: number;
  private readonly windowNs: bigint;

  constructor(opts: StateModelOptions = {}) {
    this.nowNs = opts.nowNs ?? (() => process.hrtime.bigint());
    this.minReversals = opts.minReversalsPerSec ?? DEFAULT_MIN_REVERSALS_PER_SEC;
    this.windowNs = BigInt(Math.round((opts.reversalWindowSeconds ?? DEFAULT_REVERSAL_WINDOW_SECONDS) * 1e9));
    this.state = { decks: { 1: emptyDeck(1), 2: emptyDeck(2) }, mixer: emptyMixer(), updatedAtNs: null, eventsApplied: 0 };
  }

  /** Read-only snapshot; the caller can keep it without the model mutating it. */
  snapshot(): Flx4ControllerSnapshot {
    return deepCopy(this.state);
  }

  apply(event: Flx4Event): void {
    if (event.type === "unknown") return;
    this.state.updatedAtNs = event.receivedAtNs;
    this.state.eventsApplied += 1;
    if (event.group === "pad") {
      this.applyPad(event);
      return;
    }
    if (event.group === "deck") {
      this.applyDeck(event);
      return;
    }
    if (event.group === "mixer") {
      this.applyMixer(event);
      return;
    }
    if (event.group === "browse") {
      if (event.id.startsWith("browse.load") && event.deck !== null && event.on) {
        const deck = this.state.decks[event.deck];
        deck.loads = { count: deck.loads.count + 1, lastAtNs: event.receivedAtNs };
      }
      return;
    }
    if (event.group === "effect" && event.id === "fx.level-depth" && event.complete) {
      this.state.mixer.fxLevelDepth = event.value;
    }
  }

  private applyDeck(event: Flx4ControlEvent): void {
    if (event.deck === null) return;
    const deck = this.state.decks[event.deck];
    const id = event.id.slice(`deck${event.deck}.`.length);
    if (id === "play" && !event.shift && event.on) {
      deck.play = { on: !deck.play.on, atNs: event.receivedAtNs, quality: "estimated" };
      return;
    }
    if (id === "cue") {
      deck.cue = { on: event.on, atNs: event.receivedAtNs, quality: "observed" };
      return;
    }
    if (id === "shift") {
      deck.shift = event.on;
      return;
    }
    if (id.startsWith("pad-mode.")) {
      if (event.on && event.padMode !== undefined) {
        deck.padMode = event.padMode;
        deck.padModeAtNs = event.receivedAtNs;
      }
      return;
    }
    if (id === "tempo" && event.complete) {
      deck.tempo = { position: event.value, atNs: event.receivedAtNs };
      return;
    }
    if (id.startsWith("jog.")) {
      this.applyJog(event, deck);
      return;
    }
    if (id === "sync" && event.on) {
      deck.sync = { enabled: !(deck.sync.enabled ?? false), master: false, atNs: event.receivedAtNs, quality: "estimated" };
      return;
    }
    if (id === "sync-master" && event.on) {
      deck.sync = { ...deck.sync, master: true, atNs: event.receivedAtNs };
      return;
    }
    if (id === "loop-in" && event.on) {
      deck.loop = { active: true, lastAction: "in", lastAtNs: event.receivedAtNs, beatLength: null, quality: "estimated" };
      return;
    }
    if (id === "loop-out" && event.on) {
      deck.loop = { ...deck.loop, active: true, lastAction: "out", lastAtNs: event.receivedAtNs, quality: "estimated" };
      return;
    }
    if (id === "loop-halve" && event.on) {
      const beatLength = deck.loop.beatLength === null ? null : deck.loop.beatLength / 2;
      deck.loop = { active: true, lastAction: "halve", lastAtNs: event.receivedAtNs, beatLength, quality: "estimated" };
      return;
    }
    if (id === "loop-double" && event.on) {
      const beatLength = deck.loop.beatLength === null ? null : deck.loop.beatLength * 2;
      deck.loop = { active: true, lastAction: "double", lastAtNs: event.receivedAtNs, beatLength, quality: "estimated" };
      return;
    }
    if (id === "loop-exit" && event.on) {
      const wasActive = deck.loop.active !== false;
      deck.loop = {
        active: !wasActive,
        lastAction: wasActive ? "exit" : "reloop",
        lastAtNs: event.receivedAtNs,
        beatLength: null,
        quality: "estimated",
      };
      return;
    }
    if (id === "loop-exit-shift" && event.on) {
      deck.loop = { active: false, lastAction: "exit", lastAtNs: event.receivedAtNs, beatLength: null, quality: "estimated" };
    }
  }

  private applyJog(event: Flx4ControlEvent, deck: DeckControllerState): void {
    const atNs = event.receivedAtNs;
    if (event.kind === "touch") {
      // Touching clears the reversal window; the last velocity and direction
      // stay readable so a scratch-end signal keeps its direction.
      deck.jog = { ...deck.jog, touched: event.on, atNs, reversals: event.on ? [] : deck.jog.reversals, scratchActive: false };
      return;
    }
    if (event.kind !== "jog") return;
    const direction: -1 | 0 | 1 = event.value > 0 ? 1 : event.value < 0 ? -1 : 0;
    const previous = deck.jog.direction;
    const reversed = direction !== 0 && previous !== 0 && direction !== previous;
    const reversals = reversed ? [...deck.jog.reversals, atNs] : deck.jog.reversals;
    const recent = reversals.filter((ns) => atNs - ns <= this.windowNs);
    const scratchActive = deck.jog.touched && recent.length >= this.minReversals;
    deck.jog = { touched: deck.jog.touched, velocity: event.value, direction, atNs, reversals: recent, scratchActive };
  }

  private applyPad(event: Flx4ControlEvent): void {
    if (event.deck === null || event.padIndex === undefined || event.padMode === undefined) return;
    const deck = this.state.decks[event.deck];
    if (event.on) {
      if (!deck.padsDown.includes(event.padIndex)) deck.padsDown = [...deck.padsDown, event.padIndex];
      if (event.padMode === "beat-loop" && !event.shift) {
        deck.loop = {
          active: true,
          lastAction: "beat-loop",
          lastAtNs: event.receivedAtNs,
          beatLength: BEAT_LOOP_PAD_BEATS[event.padIndex - 1] ?? null,
          quality: "estimated",
        };
      }
      if (event.padMode === "beat-loop" && event.shift) {
        // +SHIFT beat-loop pads 1 to 4 halve the loop, 5 to 8 double it.
        const factor = event.padIndex <= 4 ? 0.5 : 2;
        const beatLength = deck.loop.beatLength === null ? null : deck.loop.beatLength * factor;
        deck.loop = { active: true, lastAction: factor === 0.5 ? "halve" : "double", lastAtNs: event.receivedAtNs, beatLength, quality: "estimated" };
      }
      return;
    }
    deck.padsDown = deck.padsDown.filter((pad) => pad !== event.padIndex);
  }

  private applyMixer(event: Flx4ControlEvent): void {
    const mixer = this.state.mixer;
    const id = event.id;
    if (id === "mixer.crossfader" && event.complete) {
      mixer.crossfader = { position: event.value, atNs: event.receivedAtNs };
      return;
    }
    if (id === "mixer.master-level" && event.complete) {
      mixer.masterLevel = event.value;
      return;
    }
    if (id === "mixer.head-mix" && event.complete) {
      mixer.headMix = event.value;
      return;
    }
    if (id === "mixer.head-level" && event.complete) {
      mixer.headLevel = event.value;
      return;
    }
    if (id === "mixer.smart-cfx") {
      mixer.smartCfx = event.on;
      return;
    }
    if (id === "mixer.smart-fader") {
      mixer.smartFader = event.on;
      return;
    }
    const deckMatch = /^mixer\.deck([12])\.(.+)$/.exec(id);
    if (deckMatch === null || event.deck === null) return;
    const deck = this.state.decks[event.deck];
    const field = deckMatch[2];
    if (field === "channel-fader" && event.complete) {
      deck.channelFader = { position: event.value, atNs: event.receivedAtNs };
      return;
    }
    if (!event.complete) return;
    if (field === "trim") deck.trim = event.value;
    else if (field === "eq-high") deck.eqHigh = event.value;
    else if (field === "eq-mid") deck.eqMid = event.value;
    else if (field === "eq-low") deck.eqLow = event.value;
    else if (field === "cfx") deck.cfx = event.value;
    else if (field === "head-cue") mixer.headCue[event.deck] = event.on;
  }
}

// --- tempo range fitting ---------------------------------------------------

export type TempoRangeSetting = "source" | "6" | "10" | "16" | "wide";

/** Fixed ranges in percent, from the Rekordbox setting labels (`flx4.tempoRange`). */
export const FIXED_TEMPO_RANGE_PERCENT: Readonly<Record<"6" | "10" | "16", number>> = { 6: 6, 10: 10, 16: 16 };

export interface TempoFitSample {
  deck: Flx4Deck;
  /** Fader position 0 to 1. */
  position: number;
  /** Pitch percent the DJ software provider reports for the same moment. */
  pitchPercent: number;
}

export interface TempoFitResult {
  deck: Flx4Deck;
  /** Fitted full-range percent (for example 10 for a 10 percent setting). */
  rangePercent: number;
  samples: number;
  /** Largest per-sample deviation from the fit, in percent. */
  residualPercent: number;
  atNs: bigint;
}

export interface TempoRangeResolution {
  percent: number | null;
  source: "setting" | "fit" | "unknown";
}

/**
 * Fits the fader travel to reported pitch: pitch = (position - 0.5) * 2 * range.
 * The fit is accepted only with at least three samples, real travel, and a
 * residual at or below `maxResidualPercent` (0.5 by task definition).
 */
export class TempoRangeFit {
  private readonly samples: Record<Flx4Deck, TempoFitSample[]> = { 1: [], 2: [] };
  private readonly maxResidualPercent: number;

  constructor(maxResidualPercent = 0.5) {
    this.maxResidualPercent = maxResidualPercent;
  }

  add(sample: TempoFitSample): void {
    const list = this.samples[sample.deck];
    list.push(sample);
    if (list.length > 512) list.shift();
  }

  fit(deck: Flx4Deck): { rangePercent: number; samples: number; residualPercent: number } | null {
    const list = this.samples[deck];
    if (list.length < 3) return null;
    const xs = list.map((s) => (s.position - 0.5) * 2);
    const spread = Math.max(...xs) - Math.min(...xs);
    if (spread < 0.2) return null;
    let num = 0;
    let den = 0;
    for (let i = 0; i < list.length; i += 1) {
      const x = xs[i] ?? 0;
      num += x * (list[i]?.pitchPercent ?? 0);
      den += x * x;
    }
    if (den === 0) return null;
    const rangePercent = num / den;
    let residual = 0;
    for (let i = 0; i < list.length; i += 1) {
      residual = Math.max(residual, Math.abs((list[i]?.pitchPercent ?? 0) - (xs[i] ?? 0) * rangePercent));
    }
    if (residual > this.maxResidualPercent) return null;
    return { rangePercent, samples: list.length, residualPercent: residual };
  }
}

/** Resolves flx4.tempoRange to a percent: fixed setting, fitted range, or unknown. */
export function resolveTempoRange(setting: TempoRangeSetting, fitted: TempoFitResult | null): TempoRangeResolution {
  if (setting === "6" || setting === "10" || setting === "16") {
    return { percent: FIXED_TEMPO_RANGE_PERCENT[setting], source: "setting" };
  }
  if (fitted !== null) return { percent: fitted.rangePercent, source: "fit" };
  // "source" without provider samples and "wide" are not visible in MIDI.
  return { percent: null, source: "unknown" };
}

/** Pitch percent a fader position maps to for a given full range. */
export function pitchForPosition(position: number, rangePercent: number): number {
  return (position - 0.5) * 2 * rangePercent;
}

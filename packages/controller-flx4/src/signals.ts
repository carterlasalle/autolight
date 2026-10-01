// Transport-relevant runtime signals (T-FLX-04, spec 11, spec 61, spec 63).
//
// Every signal is a hint from secondary truth: it carries `quality`
// (`observed` when the hardware reported the control directly, `estimated`
// when it is inferred from button presses) and the fixed `source` label
// `controller`, so the fusion provider only uses it where no DJ software
// source supplies the field, or to confirm one.
//
// Scratch: jog touch plus velocity reversals, thresholds `runtime.scratch.*`.
// The reversal timestamps are the exact input the runtime's `ScratchState`
// consumes (see `packages/show-runtime/src/index.ts`, `observeRate`,
// `scratchDetected`); T-RUN-05 proves the hold and resync behaviour once they
// are folded in.
//
// Roll: on Serato DJ Pro/Lite the shift layer of the PAD FX1 key is Roll mode
// and holding a pad plays a Loop Roll (DDJ-FLX4 instruction manual, "Using
// Roll"); on rekordbox the same layer is Pad FX 2. The roll length per pad is
// a DJ software setting and is not sent over MIDI, so it is null.

import {
  BEAT_JUMP_PAD_BEATS,
  BEAT_LOOP_PAD_BEATS,
  type Flx4ControlEvent,
  type Flx4Deck,
  type Flx4Event,
  type Flx4PadMode,
} from "./map.js";
import {
  DEFAULT_MIN_REVERSALS_PER_SEC,
  DEFAULT_REVERSAL_WINDOW_SECONDS,
  type Flx4ControllerSnapshot,
  type Flx4Quality,
} from "./state.js";

export type Flx4SignalKind =
  | "scratch-start"
  | "scratch-end"
  | "cue-hold"
  | "hot-cue"
  | "pad-press"
  | "pad-release"
  | "pad-roll-start"
  | "pad-roll-stop"
  | "loop-in"
  | "loop-out"
  | "loop-halve"
  | "loop-double"
  | "loop-exit"
  | "reloop"
  | "beat-loop"
  | "beat-jump"
  | "sync"
  | "load"
  | "fader"
  | "crossfader";

interface SignalBase {
  atNs: bigint;
  quality: Flx4Quality;
  source: "controller";
}

export type Flx4Signal =
  | (SignalBase & { kind: "scratch-start" | "scratch-end"; deck: Flx4Deck; direction: -1 | 1; reversalNs: bigint[] })
  | (SignalBase & { kind: "cue-hold"; deck: Flx4Deck; on: boolean })
  | (SignalBase & { kind: "hot-cue"; deck: Flx4Deck; padIndex: number })
  | (SignalBase & { kind: "pad-press" | "pad-release"; deck: Flx4Deck; padIndex: number; padMode: Flx4PadMode })
  | (SignalBase & { kind: "pad-roll-start" | "pad-roll-stop"; deck: Flx4Deck; padIndex: number; beats: number | null })
  | (SignalBase & { kind: "loop-in" | "loop-out" | "loop-halve" | "loop-double" | "loop-exit" | "reloop"; deck: Flx4Deck; beats: number | null })
  | (SignalBase & { kind: "beat-loop"; deck: Flx4Deck; padIndex: number; beats: number })
  | (SignalBase & { kind: "beat-jump"; deck: Flx4Deck; padIndex: number; beats: number })
  | (SignalBase & { kind: "sync"; deck: Flx4Deck; on: boolean; master: boolean })
  | (SignalBase & { kind: "load"; deck: Flx4Deck })
  | (SignalBase & { kind: "fader"; deck: Flx4Deck; value: number })
  | (SignalBase & { kind: "crossfader"; value: number });

export type DjSoftwareName = "rekordbox" | "serato";

export interface SignalOptions {
  /** Which DJ software is live; Roll pads only exist in Serato (manual citation above). */
  djSoftware?: DjSoftwareName | null;
  /** runtime.scratch.minReversalsPerSec. */
  minReversalsPerSec?: number;
  /** Reversal window in seconds, matching the runtime's one-second window. */
  reversalWindowSeconds?: number;
}

/**
 * Turns decoded events into runtime signals. Keep one deriver per service:
 * it tracks the per-deck scratch state so transitions are edges, not repeats.
 */
export class Flx4SignalDeriver {
  private readonly scratch: Record<Flx4Deck, boolean> = { 1: false, 2: false };
  private readonly opts: Required<SignalOptions>;

  constructor(opts: SignalOptions = {}) {
    this.opts = {
      djSoftware: opts.djSoftware ?? null,
      minReversalsPerSec: opts.minReversalsPerSec ?? DEFAULT_MIN_REVERSALS_PER_SEC,
      reversalWindowSeconds: opts.reversalWindowSeconds ?? DEFAULT_REVERSAL_WINDOW_SECONDS,
    };
  }

  derive(event: Flx4Event, state: Flx4ControllerSnapshot): Flx4Signal[] {
    const signals: Flx4Signal[] = [];
    if (event.type === "unknown") return signals;
    const atNs = event.receivedAtNs;
    if (event.deck !== null) {
      const deck = event.deck;
      const jog = state.decks[deck].jog;
      const scratchNow = jog.scratchActive;
      if (scratchNow !== this.scratch[deck]) {
        this.scratch[deck] = scratchNow;
        const direction: -1 | 1 = jog.direction < 0 ? -1 : 1;
        signals.push({
          kind: scratchNow ? "scratch-start" : "scratch-end",
          deck,
          direction,
          reversalNs: [...jog.reversals],
          atNs,
          quality: "estimated",
          source: "controller",
        });
      }
    }
    if (event.group === "deck") {
      signals.push(...this.fromDeck(event, state));
      return signals;
    }
    if (event.group === "pad") {
      signals.push(...this.fromPad(event, state));
      return signals;
    }
    if (event.group === "mixer" && event.complete) {
      if (event.id === "mixer.crossfader") {
        signals.push({ kind: "crossfader", value: event.value, atNs, quality: "observed", source: "controller" });
      } else if (event.deck !== null && event.id.endsWith(".channel-fader")) {
        signals.push({ kind: "fader", deck: event.deck, value: event.value, atNs, quality: "observed", source: "controller" });
      }
      return signals;
    }
    if (event.group === "browse" && event.id.startsWith("browse.load") && event.on && event.deck !== null) {
      signals.push({ kind: "load", deck: event.deck, atNs, quality: "observed", source: "controller" });
    }
    return signals;
  }

  /** Scratch trace a runtime caller folds into its own scratch state. */
  scratchTrace(state: Flx4ControllerSnapshot, deck: Flx4Deck): { active: boolean; reversalNs: bigint[]; direction: -1 | 0 | 1 } {
    const jog = state.decks[deck].jog;
    return { active: jog.scratchActive, reversalNs: [...jog.reversals], direction: jog.direction };
  }

  private fromDeck(event: Flx4ControlEvent, state: Flx4ControllerSnapshot): Flx4Signal[] {
    const deck = event.deck;
    if (deck === null) return [];
    const atNs = event.receivedAtNs;
    const id = event.id.slice(`deck${deck}.`.length);
    if (id === "cue" && !event.shift) {
      return [{ kind: "cue-hold", deck, on: event.on, atNs, quality: "observed", source: "controller" }];
    }
    if (id === "loop-in" || id === "loop-out") {
      return event.on
        ? [{ kind: id === "loop-in" ? "loop-in" : "loop-out", deck, beats: null, atNs, quality: "estimated", source: "controller" }]
        : [];
    }
    if (id === "loop-halve" || id === "loop-double") {
      return event.on
        ? [{ kind: id, deck, beats: state.decks[deck].loop.beatLength, atNs, quality: "estimated", source: "controller" }]
        : [];
    }
    if (id === "loop-exit" && event.on) {
      const action = state.decks[deck].loop.lastAction;
      return [{ kind: action === "reloop" ? "reloop" : "loop-exit", deck, beats: null, atNs, quality: "estimated", source: "controller" }];
    }
    if ((id === "sync" || id === "sync-master") && event.on && !event.shift) {
      const sync = state.decks[deck].sync;
      return [{ kind: "sync", deck, on: sync.enabled === true, master: sync.master, atNs, quality: "estimated", source: "controller" }];
    }
    return [];
  }

  private fromPad(event: Flx4ControlEvent, state: Flx4ControllerSnapshot): Flx4Signal[] {
    const deck = event.deck;
    if (deck === null || event.padIndex === undefined || event.padMode === undefined) return [];
    const atNs = event.receivedAtNs;
    const base = { atNs, quality: "observed" as const, source: "controller" as const };
    if (event.padMode === "hot-cue" && !event.shift) {
      return event.on ? [{ kind: "hot-cue", deck, padIndex: event.padIndex, ...base }] : [];
    }
    if (event.padMode === "beat-loop" && !event.shift && event.on) {
      const beats = BEAT_LOOP_PAD_BEATS[event.padIndex - 1] ?? 1;
      return [{ kind: "beat-loop", deck, padIndex: event.padIndex, beats, ...base }];
    }
    if (event.padMode === "beat-loop" && event.shift && event.on) {
      const halves = event.padIndex <= 4;
      return [{
        kind: halves ? "loop-halve" : "loop-double",
        deck,
        beats: state.decks[deck].loop.beatLength,
        atNs,
        quality: "estimated",
        source: "controller",
      }];
    }
    if (event.padMode === "beat-jump" && event.on) {
      const factor = event.shift ? 16 : 1;
      const beats = (BEAT_JUMP_PAD_BEATS[event.padIndex - 1] ?? 1) * factor;
      return [{ kind: "beat-jump", deck, padIndex: event.padIndex, beats, ...base }];
    }
    const rollLayer = event.padMode === "pad-fx-2" && this.opts.djSoftware === "serato";
    if (rollLayer) {
      return [{
        kind: event.on ? "pad-roll-start" : "pad-roll-stop",
        deck,
        padIndex: event.padIndex,
        beats: null,
        atNs,
        quality: "estimated",
        source: "controller",
      }];
    }
    return [{ kind: event.on ? "pad-press" : "pad-release", deck, padIndex: event.padIndex, padMode: event.padMode, ...base }];
  }
}

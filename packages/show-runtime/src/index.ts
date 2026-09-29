import type { DeckState, ShowCue, ShowPlan } from "@autolight/contracts";
import { estimatePosition, isSeek } from "@autolight/dj-core";

// ShowCursor: random-access evaluation of a ShowPlan at any beat (§58).
// Loops re-evaluate the same region; seeks snap without replaying history.
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

// Map a looped source beat back into [loopStart, loopEnd), counting passes.
// Pass parity drives deterministic traversal variation (§59): A/B/A...
export function loopBeat(beat: number, loopStart: number, loopEnd: number): { beat: number; pass: number } {
  const len = loopEnd - loopStart;
  if (!(len > 0) || beat < loopStart) return { beat, pass: 0 };
  const pass = Math.floor((beat - loopStart) / len);
  return { beat: loopStart + ((beat - loopStart) % len), pass };
}

// Track a deck observation: seek snap vs smooth follow vs scratch hold (§58, §61).
export interface TrackedDeck {
  beat: number;
  scratchHold: boolean;
  seeked: boolean;
}

export function trackDeck(
  prevBeat: number,
  obs: DeckState,
  gridBeat: (seconds: number) => number,
  opts: { seekThresholdBeats?: number; scratchRate?: number } = {},
): TrackedDeck {
  const observed = gridBeat(obs.playheadSeconds);
  const predicted = prevBeat + 0; // caller advances via estimatePosition; here: compare jump
  const jumped = Math.abs(observed - predicted) > (opts.seekThresholdBeats ?? 8) || isSeek(prevBeat, observed, 8);
  void predicted;
  if ((opts.scratchRate ?? obs.playRate) < 0 || obs.playRate < 0) {
    return { beat: prevBeat, scratchHold: true, seeked: false };
  }
  if (obs.playRate === 0 && Math.abs(observed - prevBeat) > 0.5) {
    // Scrubbing while paused: hold look, don't chase design (§61).
    return { beat: prevBeat, scratchHold: true, seeked: false };
  }
  if (jumped) return { beat: observed, scratchHold: false, seeked: true };
  return { beat: observed, scratchHold: false, seeked: false };
}
export function cursorBeat(state: CursorState): number {
  return state.beat;
}

// Fault-degraded clock (§105): 0-500ms extrapolate, 500ms-2s hold look,
// beyond → timing-degraded (adaptive clock). Never cut to black on one drop.
export type ClockHealth = "live" | "extrapolating" | "holding" | "degraded";

export function clockHealth(msSinceLastUpdate: number): ClockHealth {
  if (msSinceLastUpdate <= 500) return msSinceLastUpdate <= 0 ? "live" : "extrapolating";
  if (msSinceLastUpdate <= 2000) return "holding";
  return "degraded";
}

export { estimatePosition };
export type { DeckState };

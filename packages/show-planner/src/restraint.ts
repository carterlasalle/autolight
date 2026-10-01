// Restraint engine (T-PLAN-05, spec 34/78). Every candidate passes through
// here, which accepts, substitutes or rejects with a recorded reason. One
// runtime instance of the same engine governs live decisions.
import type { PlannerConfigSnapshot, PlannerStyle } from "./types.js";

export interface RestraintState {
  lastBlackoutBeat: number;
  lastWhiteHitBeat: number;
  lastStrobeBeat: number;
  strobeBeats: number;
  strobeWindowBeats: number;
  lastPaletteChange: number;
  currentPatternFamily: string;
  patternRepeatCount: number;
  recentSpatialDirections: string[];
  recentImpactTypes: string[];
  sectionImpactCount: number;
  wholeTrackImpactCount: number;
  blinderBeats: number;
  sectionStartBeat: number;
}

export function freshRestraint(): RestraintState {
  return {
    lastBlackoutBeat: -Infinity,
    lastWhiteHitBeat: -Infinity,
    lastStrobeBeat: -Infinity,
    strobeBeats: 0,
    strobeWindowBeats: 0,
    lastPaletteChange: -Infinity,
    currentPatternFamily: "",
    patternRepeatCount: 0,
    recentSpatialDirections: [],
    recentImpactTypes: [],
    sectionImpactCount: 0,
    wholeTrackImpactCount: 0,
    blinderBeats: 0,
    sectionStartBeat: -Infinity,
  };
}

export type RestraintVerdict =
  | { readonly decision: "accept"; readonly reason?: undefined }
  | { readonly decision: "substitute"; readonly substitute: string; readonly reason: string }
  | { readonly decision: "reject"; readonly reason: string };

export interface RestraintRecord {
  readonly beat: number;
  readonly requested: string;
  readonly verdict: RestraintVerdict;
}

export function observeSection(state: RestraintState, sectionStartBeat: number): void {
  state.sectionStartBeat = sectionStartBeat;
  state.sectionImpactCount = 0;
}

function notePattern(state: RestraintState, family: string, config: PlannerConfigSnapshot): RestraintVerdict | null {
  if (state.currentPatternFamily === family) {
    state.patternRepeatCount++;
  } else {
    state.currentPatternFamily = family;
    state.patternRepeatCount = 1;
  }
  if (state.patternRepeatCount > config.patternRepeatMax) {
    return {
      decision: "substitute",
      substitute: "pulse",
      reason: `pattern ${family} repeated ${state.patternRepeatCount}, varying with a pulse`,
    };
  }
  return null;
}

export function restrain(
  state: RestraintState,
  type: string,
  beat: number,
  durationBeats: number,
  style: PlannerStyle,
  config: PlannerConfigSnapshot,
  opts: { direction?: string; family?: string; impact?: boolean } = {},
): { verdict: RestraintVerdict; state: RestraintState } {
  const scale = 0.5 + style.impactAggression;
  const whiteMin = config.whiteHitMinBeats;
  const blackoutMin = config.blackoutMinBeats;
  if (type === "white-hit") {
    if (beat - state.lastWhiteHitBeat < whiteMin) {
      return {
        state,
        verdict: {
          decision: "substitute",
          substitute: "impact",
          reason: `white hit ${beat - state.lastWhiteHitBeat} beats after the last one becomes a full-colour impact`,
        },
      };
    }
    if (state.wholeTrackImpactCount >= config.trackImpactMax * scale) {
      return {
        state,
        verdict: {
          decision: "substitute",
          substitute: "impact",
          reason: "track impact budget spent, full-colour impact instead",
        },
      };
    }
    if (state.sectionImpactCount >= config.sectionImpactMax) {
      return {
        state,
        verdict: {
          decision: "substitute",
          substitute: "impact",
          reason: "section impact budget spent, full-colour impact instead",
        },
      };
    }
    state.lastWhiteHitBeat = beat;
    state.blinderBeats += durationBeats;
  }
  if (type === "blackout") {
    if (beat - state.lastBlackoutBeat < blackoutMin) {
      return {
        state,
        verdict: {
          decision: "substitute",
          substitute: "dip",
          reason: "blackout too close to the last one, dipping instead",
        },
      };
    }
    state.lastBlackoutBeat = beat;
  }
  if (type === "strobe-burst" || type === "strobe") {
    const duty = state.strobeWindowBeats > 0 ? state.strobeBeats / state.strobeWindowBeats : 0;
    if (duty + durationBeats / 64 > config.strobeMaxDuty * scale + 0.02) {
      return {
        state,
        verdict: { decision: "reject", reason: `strobe duty ${duty.toFixed(3)} at budget, rejecting` },
      };
    }
    if (style.strobeFrequency <= 0 && durationBeats > 0) {
      return {
        state,
        verdict: { decision: "reject", reason: "style disables strobes" },
      };
    }
    state.lastStrobeBeat = beat;
    state.strobeBeats += durationBeats;
  }
  if (opts.direction) {
    state.recentSpatialDirections.push(opts.direction);
    if (state.recentSpatialDirections.length > 8) state.recentSpatialDirections.shift();
    const same = state.recentSpatialDirections.filter((d) => d === opts.direction).length;
    if (same >= 5) {
      return {
        state,
        verdict: {
          decision: "substitute",
          substitute: type,
          reason: `spatial direction ${opts.direction} repeated ${same} times, mirrored elsewhere`,
        },
      };
    }
  }
  if (opts.family) {
    const varied = notePattern(state, opts.family, config);
    if (varied) return { state, verdict: varied };
  }
  if (opts.impact) {
    state.sectionImpactCount++;
    state.wholeTrackImpactCount++;
    state.recentImpactTypes.push(type);
    if (state.recentImpactTypes.length > 6) state.recentImpactTypes.shift();
    const repeats = state.recentImpactTypes.filter((t) => t === type).length;
    if (repeats >= 3 && type === "white-hit") {
      return {
        state,
        verdict: {
          decision: "substitute",
          substitute: "impact",
          reason: "same impact type three times running, varying the colour",
        },
      };
    }
  }
  return { state, verdict: { decision: "accept" } };
}

export function notePaletteChange(state: RestraintState, beat: number): void {
  state.lastPaletteChange = beat;
}

// Blinder requests (manual "blinder on phrase") go through the same budgets:
// they fire only with enough gap and cannot exceed the track budget.
export function requestBlinder(
  state: RestraintState,
  beat: number,
  durationBeats: number,
  phraseBoundary: boolean,
  config: PlannerConfigSnapshot,
): RestraintVerdict {
  if (!phraseBoundary) {
    return { decision: "reject", reason: "blinder request off a phrase boundary" };
  }
  if (beat - state.lastWhiteHitBeat < config.whiteHitMinBeats) {
    return { decision: "reject", reason: "blinder request inside the white-hit gap" };
  }
  if (state.wholeTrackImpactCount >= config.trackImpactMax) {
    return { decision: "reject", reason: "blinder request over the track impact budget" };
  }
  state.lastWhiteHitBeat = beat;
  state.wholeTrackImpactCount++;
  state.blinderBeats += durationBeats;
  return { decision: "accept" };
}

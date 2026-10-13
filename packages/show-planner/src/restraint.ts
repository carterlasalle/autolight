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
    strobeWindowBeats: 64,
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

// One shared impact budget: the same scaled track limit plus the section
// limit, checked by both restrain and requestBlinder so the two paths cannot
// diverge.
function impactBudgetExceeded(state: RestraintState, scale: number, config: PlannerConfigSnapshot): boolean {
  return (
    state.wholeTrackImpactCount >= config.trackImpactMax * scale ||
    state.sectionImpactCount >= config.sectionImpactMax
  );
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

    if (impactBudgetExceeded(state, scale, config)) {
      return {
        state,
        verdict: {
          decision: "substitute",
          substitute: "impact",
          reason: "impact budget spent, full-colour impact instead",
        },
      };
    }
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
  }

  if (type === "strobe-burst" || type === "strobe") {
    // Rolling 64-beat duty window: strobes older than the window fall out,
    // so the duty check actually limits cumulative strobe load.
    if (state.lastStrobeBeat < beat - 64) state.strobeBeats = 0;
    const duty = state.strobeBeats / 64;

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

  }

  if (opts.direction) {
    // Probe against a copy: the push below must only land on accept.
    const recent = [...state.recentSpatialDirections, opts.direction].slice(-8);
    const same = recent.filter((d) => d === opts.direction).length;

    if (same >= 5) {
      // A repeated direction must vary the show: mirror it instead of
      // re-emitting the identical effect.
      const mirrored = type === "chase" ? "pulse" : `mirrored-${type}`;

      return {
        state,
        verdict: {
          decision: "substitute",
          substitute: mirrored,
          reason: `spatial direction ${opts.direction} repeated ${same} times, mirrored elsewhere`,
        },
      };
    }
  }

  if (opts.family) {
    // Probe the pattern check against a copy: notePattern advances the
    // repeat counter, and a substituted pattern must not consume it.
    const probe: RestraintState = {
      ...state,
      recentSpatialDirections: [...state.recentSpatialDirections],
      recentImpactTypes: [...state.recentImpactTypes],
    };

    const varied = notePattern(probe, opts.family, config);

    if (varied) return { state, verdict: varied };
  }

  if (opts.impact) {
    // Probe impact-repeat against a copy so a substituted repeat does not
    // consume the budget; the commit block at the end writes on accept.
    const recentImpacts = [...state.recentImpactTypes, type].slice(-6);
    const repeats = recentImpacts.filter((t) => t === type).length;

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

  // Accept path: commit every probe above so restraint learns.
  if (type === "white-hit") {
    state.lastWhiteHitBeat = beat;
    state.blinderBeats += durationBeats;
  }

  if (type === "blackout") state.lastBlackoutBeat = beat;

  if (type === "strobe-burst" || type === "strobe") {
    state.lastStrobeBeat = beat;
    state.strobeBeats += durationBeats;
  }

  if (opts.direction) {
    state.recentSpatialDirections.push(opts.direction);

    if (state.recentSpatialDirections.length > 8) state.recentSpatialDirections.shift();
  }

  // A white hit always consumes impact budget, even when the caller omits
  // `impact: true` (compile.ts passes the flag today; the engine must not
  // depend on it).
  if (opts.impact === true || type === "white-hit") {
    state.sectionImpactCount++;
    state.wholeTrackImpactCount++;
    state.recentImpactTypes.push(type);

    if (state.recentImpactTypes.length > 6) state.recentImpactTypes.shift();
  }

  if (opts.family) notePattern(state, opts.family, config);

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
  scale = 1,
): RestraintVerdict {
  if (!phraseBoundary) {
    return { decision: "reject", reason: "blinder request off a phrase boundary" };
  }

  if (beat - state.lastWhiteHitBeat < config.whiteHitMinBeats) {
    return { decision: "reject", reason: "blinder request inside the white-hit gap" };
  }

  if (impactBudgetExceeded(state, scale, config)) {
    return { decision: "reject", reason: "blinder request over the impact budget" };
  }

  state.lastWhiteHitBeat = beat;
  state.sectionImpactCount++;
  state.wholeTrackImpactCount++;
  state.blinderBeats += durationBeats;

  return { decision: "accept" };
}

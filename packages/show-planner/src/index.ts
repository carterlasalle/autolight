// New planner index: clean cutover. compileShow is the entry point;
// planShow keeps the legacy signature for the mixer, renderer and pipeline
// consumers, delegating with the default venue and config. The primitive
// registry stays the authority on names; the re-export below is its package
// path (T-PLAN-04 seam).
import type { ShowCue, ShowPlan, ShowStyle, TrackModel } from "@autolight/contracts";
import { compileShow, PLANNER_VERSION } from "./compile.js";
import { DEFAULT_CONFIG } from "./config.js";
import { DEFAULT_VENUE_CLASS } from "./types.js";
import { BUILT_IN_STYLES as NEW_STYLES } from "./styles.js";
import type { PlannerStyle } from "./types.js";

export { compileShow, PLANNER_VERSION };
export { DEFAULT_CONFIG, resolveConfig, configHash } from "./config.js";
export { BUILT_IN_STYLES, DEFAULT_STYLE_ID, resolveStyle, STYLE_IDS } from "./styles.js";
export { compileShow as compile } from "./compile.js";
export { validateCompiledPlan, evaluateCompiledPlan, diagnosticsOutOfBounds, countPaletteChanges } from "./validate.js";
export { freshRestraint, restrain, requestBlinder, observeSection } from "./restraint.js";
export { planRecurrence, sectionSimilarity, summarizeSections } from "./recurrence.js";
export { planTrackEvents, planEvent } from "./events.js";
export { dropProgram, breakdownCues, fakeDropHold } from "./contrast.js";
export { pickCandidate, registerEvaluator, evaluatorNames, scoreCandidate, vetoCandidate } from "./scoring.js";
export { cueId, regenerateWithLocks, applyEdits, inLockedRegion } from "./corrections.js";
export { PlanCache, cacheKeyFor, spliceSection } from "./cache.js";
export { blendOklch, blendRgb, oklchDistance, oklabDistance, ensureMinDistance } from "./color.js";
export { planIdentity, colourChangeAllowed } from "./identity.js";
export {
  trackArcPosition,
  findDropPlans,
  stagedBuild,
  phraseCues,
  barCues,
  beatCues,
  subBeatCues,
  LEVEL_ATTRIBUTES,
  CUE_LEVEL_ATTRIBUTES,
} from "./hierarchy.js";
export type {
  Beat,
  EnvelopeTime,
  CueLevel,
  PlanLayer,
  SpatialSelector,
  Oklch,
  PlanCue,
  GlobalDesign,
  SectionPlan,
  MotifEntry,
  MotifMap,
  ShowConstraints,
  DeterminismRecord,
  CompiledShowPlan,
  VenueCapabilityClass,
  PlannerConfigSnapshot,
  PlannerStyle,
  PlanDiagnostics,
  RejectedCandidate,
  PlanEdits,
  CompileInput,
  CompileResult,
} from "./types.js";
export {
  DEFAULT_VENUE_CLASS,
  EMPTY_EDITS,
  envelopeToBeats,
  fnv1aHex,
  hashValue,
  isCueLevel,
  isPlanLayer,
  mulberry32,
  selectorHasDeviceRef,
  selectorName,
  stableStringify,
  stringHasDeviceRef,
  trackFingerprint,
} from "./types.js";
export * from "./primitives.js";

function toPlannerStyle(style: ShowStyle): PlannerStyle {
  const base = NEW_STYLES[style.id] ?? NEW_STYLES["club"]!;
  return {
    ...base,
    id: style.id,
    intensityRange: style.intensityRange,
    darknessPreference: style.darknessPreference,
    whiteHitFrequency: style.whiteHitFrequency,
    strobeFrequency: style.strobeFrequency,
    reactiveAmount: style.reactiveAmount,
  };
}

// Legacy seed: fingerprint-aware when the identity carries one, else the id.
export function seedFor(trackId: string, plannerVersion: string, styleId: string): string {
  let h = 0x811c9dc5;
  for (const c of `${trackId}|${plannerVersion}|${styleId}`) {
    h ^= c.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Legacy entry point: every existing consumer keeps compiling. Delegates to
// compileShow with the default venue class and registry-mirrored config, and
// strips the v2 metadata back to the legacy ShowPlan shape.
export function planShow(track: TrackModel, style: ShowStyle): ShowPlan {
  const { plan } = compileShow({
    track,
    venue: DEFAULT_VENUE_CLASS,
    style: toPlannerStyle(style),
    config: DEFAULT_CONFIG,
  });
  const cues: ShowCue[] = plan.cues.map((c) => ({
    type: c.type,
    startBeat: c.startBeat,
    durationBeats: c.durationBeats,
    intensity: c.intensity,
    target: c.target,
    priority: c.priority,
  }));
  return {
    schemaVersion: 1,
    plannerVersion: plan.plannerVersion,
    trackId: plan.trackId,
    styleId: plan.styleId,
    seed: plan.seed,
    cues,
  };
}

// Legacy section helpers, kept for the existing unit test.
const SECTION_ENERGY: Record<string, number> = {
  intro: 0.3,
  verse: 0.45,
  prechorus: 0.6,
  build: 0.8,
  drop: 1,
  chorus: 0.9,
  breakdown: 0.25,
  bridge: 0.5,
  instrumental: 0.6,
  solo: 0.7,
  outro: 0.3,
  transition: 0.5,
  unknown: 0.5,
};

export function sectionEnergy(kind: string): number {
  return SECTION_ENERGY[kind] ?? 0.5;
}

export function motifVariant(kind: string, occurrence: number): "forward" | "reverse" {
  void kind;
  return occurrence % 2 === 0 ? "forward" : "reverse";
}

export interface TrackIdentity2 {
  coreHues: [number, number];
  accentHue: number;
}

export function trackIdentity(seedHex: string, rand: () => number): TrackIdentity2 {
  void seedHex;
  const h1 = Math.floor(rand() * 360);
  const h2 = (h1 + 120 + Math.floor(rand() * 120)) % 360;
  return { coreHues: [h1, h2], accentHue: (h1 + 180) % 360 };
}

// Legacy corrections: index-based, kept for the existing unit test. New code
// uses regenerateWithLocks with stable cue IDs.
export function regenerateSection(
  plan: ShowPlan,
  startBeat: number,
  endBeat: number,
  fresh: ShowCue[],
  lockedIndices: number[],
): ShowPlan {
  const locked = new Set(lockedIndices);
  const kept = plan.cues.filter(
    (c, i) => locked.has(i) || c.startBeat + c.durationBeats <= startBeat || c.startBeat >= endBeat,
  );
  return {
    ...plan,
    cues: [...kept, ...fresh].sort((a, b) => a.startBeat - b.startBeat || b.priority - a.priority),
  };
}

// Legacy validator diagnostics, kept for the existing unit test.
export function validatePlan(plan: ShowPlan, durationBeats: number): string[] {
  const problems: string[] = [];
  const exclusives = plan.cues
    .filter((c) => c.type === "blackout" || c.type === "white-hit")
    .sort((a, b) => a.startBeat - b.startBeat);
  for (let i = 1; i < exclusives.length; i++) {
    const prev = exclusives[i - 1]!;
    const cur = exclusives[i]!;
    if (cur.startBeat < prev.startBeat + prev.durationBeats) {
      problems.push(`overlapping exclusive ${prev.type}@${prev.startBeat} vs ${cur.type}@${cur.startBeat}`);
    }
  }
  for (const c of plan.cues) {
    if (c.durationBeats < 0) problems.push(`negative duration ${c.type}@${c.startBeat}`);
    if (c.startBeat < 0 || c.startBeat > durationBeats) problems.push(`out-of-range ${c.type}@${c.startBeat}`);
  }
  const paletteChanges = plan.cues.filter((c) => c.type === "section-look").length;
  if (paletteChanges > durationBeats) problems.push(`palette change every beat (${paletteChanges})`);
  return problems;
}

export function evaluatePlan(plan: ShowPlan): {
  cueCount: number;
  blackoutBeats: number;
  whiteHits: number;
  strobeBeats: number;
  meanIntensity: number;
} {
  const at = (t: string): ShowCue[] => plan.cues.filter((c) => c.type === t);
  const beats = (cs: ShowCue[]): number => cs.reduce((n, c) => n + c.durationBeats, 0);
  return {
    cueCount: plan.cues.length,
    blackoutBeats: beats(at("blackout")),
    whiteHits: at("white-hit").length,
    strobeBeats: beats(at("strobe")),
    meanIntensity: plan.cues.length ? plan.cues.reduce((n, c) => n + c.intensity, 0) / plan.cues.length : 0,
  };
}

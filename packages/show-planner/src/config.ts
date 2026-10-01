// Planner configuration snapshot (T-PLAN-09). Every planner number lives
// here, mirroring packages/config registry planner.* keys. Callers pass a
// partial; resolveConfig fills defaults. No other planner module carries a
// behavioural literal.
import { hashValue, type PlannerConfigSnapshot } from "./types.js";

export const DEFAULT_CONFIG: PlannerConfigSnapshot = {
  sectionEnergy: {
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
  },
  dropMinConfidence: 0.5,
  dropStages: [8, 8, 8, 4, 4],
  dropPreDarknessBeats: 1,
  dropBurstBeats: 2,
  whiteHitMinBeats: 16,
  blackoutMinBeats: 32,
  strobeMaxDuty: 0.08,
  paletteChangeMinBeats: 16,
  patternRepeatMax: 4,
  sectionImpactMax: 3,
  trackImpactMax: 12,
  breakdownMaxMean: 0.3,
  similarityThreshold: 0.8,
  candidatesPerSection: 4,
  chaseBasePeriodBeats: 8,
  paletteMinDistance: 0.12,
  eventMinConfidence: {},
  defaultEventConfidence: 0.5,
  evaluationBounds: {
    activeDensity: [0, 1],
    darknessPct: [0, 1],
    colourChangeRate: [0, 2],
    whiteHits: [0, 12],
    blackouts: [0, 12],
    strobeBeats: [0, 32],
    patternRecurrence: [0, 1],
    spatialEntropy: [0, 3],
    sectionContrast: [0, 1],
    intensityArc: [0, 1],
  },
  compileBudgetMs: 2000,
  impactDefaultMs: 90,
};

export function resolveConfig(
  partial?: Partial<PlannerConfigSnapshot>,
): PlannerConfigSnapshot {
  if (!partial) return DEFAULT_CONFIG;
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    sectionEnergy: { ...DEFAULT_CONFIG.sectionEnergy, ...(partial.sectionEnergy ?? {}) },
    eventMinConfidence: { ...(partial.eventMinConfidence ?? {}) },
    evaluationBounds: { ...DEFAULT_CONFIG.evaluationBounds, ...(partial.evaluationBounds ?? {}) },
  };
}

export function configHash(c: PlannerConfigSnapshot): string {
  return hashValue(c);
}

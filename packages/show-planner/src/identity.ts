// Whole-song identity and colour story (T-PLAN-02, spec 28/29). Chooses the
// globalDesign before any cue: 2 to 3 core colours in OKLCH, a neutral accent,
// a spatial motif, the movement vocabulary and the baselines/budgets. Colour
// changes are recorded only at section, phrase or motif-return boundaries.
import type { TrackModel } from "@autolight/contracts";
import { ensureMinDistance, generateCorePalette, neutralWhite } from "./color.js";
import {
  mulberry32,
  type GlobalDesign,
  type Oklch,
  type PlannerConfigSnapshot,
  type PlannerStyle,
} from "./types.js";

export const MOVEMENT_FAMILIES = [
  "rise",
  "fall",
  "cross",
  "fan",
  "converge",
  "diverge",
  "chase",
  "outside-in",
  "inside-out",
  "vertical-scan",
  "rotation",
] as const;

export function vocabularyForEnergy(mean: number, movementDensity: number): string[] {
  const count = 2 + Math.round(Math.min(1, Math.max(0, movementDensity)) * 4);
  const ranked = [...MOVEMENT_FAMILIES];
  const start = Math.floor(Math.min(1, Math.max(0, mean)) * ranked.length) % ranked.length;
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(ranked[(start + i * 3) % ranked.length]!);
  return out;
}

export function sectionEnergies(
  track: TrackModel,
  energy: Readonly<Record<string, number>>,
): number[] {
  return track.sections.map((s) => energy[s.kind] ?? energy["unknown"] ?? 0.5);
}

export function planIdentity(
  track: TrackModel,
  style: PlannerStyle,
  config: PlannerConfigSnapshot,
  seedHex: string,
): { design: GlobalDesign; core: Oklch[]; accent: Oklch; sectionStarts: number[] } {
  const rand = mulberry32(seedHex);
  const energies = sectionEnergies(track, config.sectionEnergy);
  const mean = energies.length ? energies.reduce((a, b) => a + b, 0) / energies.length : 0.5;
  const third = rand() < 0.4 + style.colorSaturation * 0.3;
  const core = ensureMinDistance(
    generateCorePalette(rand, style.colorSaturation, mean, third),
    config.paletteMinDistance,
  );
  const accent = neutralWhite();
  const heads = 1 + Math.floor(rand() * 3);
  const direction = rand() < 0.5 ? "clockwise" : "counterclockwise";
  const density = Math.min(1, Math.max(0, style.spatialDensity * (0.5 + mean * 0.7)));
  const contrast = Math.min(1, Math.max(0, 0.4 + mean * 0.5));
  const budget = Math.max(2, Math.round(config.trackImpactMax * style.impactAggression));
  const darkBeats = Math.round(style.darknessPreference * 16);
  return {
    design: {
      primary: core.slice(0, 2),
      secondary: core.slice(2),
      neutral: accent,
      spatialMotif: { origin: "dj", direction, heads },
      movementVocabulary: vocabularyForEnergy(mean, style.movementDensity),
      densityBaseline: density,
      contrastBaseline: contrast,
      impactBudget: budget,
      darknessBudgetBeats: darkBeats,
    },
    core,
    accent,
    sectionStarts: track.sections.map((s) => s.startBeat),
  };
}

// True when a colour change at this beat is musically justified: a section or
// phrase boundary, or a motif return. The planner only changes colour at
// those points; the evaluator measures it.
export function colourChangeAllowed(
  beat: number,
  sectionStarts: readonly number[],
  phraseStarts: readonly number[],
  motifReturnBeats: readonly number[],
): boolean {
  return (
    sectionStarts.includes(beat) || phraseStarts.includes(beat) || motifReturnBeats.includes(beat)
  );
}

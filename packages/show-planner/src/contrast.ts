// Contrast engine and drop programming (T-PLAN-06, spec 35/36). Breakdowns
// go low and narrow; builds rise in fixtures, speed and brightness; the final
// pre-drop beat may black out; the drop lands a white impact of
// render.impact.defaultMs (beats at compile time via tempo), a quantized
// burst, then a saturated body with spatial alternation. Fake drops hold
// black and fire nothing at the fake impact.
import type { Oklch, PlannerConfigSnapshot, PlannerStyle } from "./types.js";
import { envelopeToBeats } from "./types.js";

export interface ContrastCue {
  type: string;
  startBeat: number;
  durationBeats: number;
  intensity: number;
  target: string;
  priority: number;
  color?: Oklch;
  reason: string;
}

export function breakdownCues(
  startBeat: number,
  endBeat: number,
  style: PlannerStyle,
  config: PlannerConfigSnapshot,
  core: readonly Oklch[],
): ContrastCue[] {
  const narrow = core[0] ?? { l: 0.5, c: 0.08, h: 220 };
  // The spec caps breakdown mean brightness at planner.contrast.breakdownMaxMean
  // (spec 35/36): derive both layers from that cap, deepened by the style's
  // darknessPreference, instead of hardcoding values the config cannot move.
  const cap = Math.max(0, config.breakdownMaxMean);
  const dark = 1 - Math.min(1, Math.max(0, style.darknessPreference));
  const lookIntensity = cap * (0.6 + 0.2 * dark);
  const textureIntensity = cap * (0.4 + 0.2 * dark);

  return [
    {
      type: "breakdown-look",
      startBeat,
      durationBeats: Math.max(0, endBeat - startBeat),
      intensity: lookIntensity,
      target: "AMBIENT",
      priority: 40,
      color: narrow,
      reason: "breakdown: low brightness, few segments, narrow palette",
    },
    {
      type: "texture-hold",
      startBeat,
      durationBeats: Math.max(0, endBeat - startBeat),
      intensity: textureIntensity,
      target: "AMBIENT",
      priority: 41,
      color: narrow,
      reason: "breakdown texture hold",
    },
  ];
}

export interface DropProgram {
  cues: ContrastCue[];
  staged: number;
}

export function dropProgram(
  buildStart: number,
  impactBeat: number,
  strength: number,
  occurrence: number,
  style: PlannerStyle,
  config: PlannerConfigSnapshot,
  core: readonly Oklch[],
  bpm: number,
): DropProgram {
  const cues: ContrastCue[] = [];
  // Stage the real build window, never past the impact: a build shorter than
  // 4 beats skips staging (no room for ramps) instead of overflowing into
  // the drop. The configured stage weights are consumed in proportion so the
  // numeric entries matter and `staged` always reflects the config.
  const buildLength = impactBeat - buildStart;
  const weights = config.dropStages.filter((beats) => Number.isFinite(beats) && beats > 0);
  const weightTotal = weights.reduce((total, beats) => total + beats, 0);
  const stages = buildLength >= 4 && weightTotal > 0 ? weights.length : 0;
  let stageStart = buildStart;

  for (let i = 0; i < stages; i++) {
    const stageLen = (weights[i]! / weightTotal) * buildLength;
    const t = (i + 1) / stages;

    const desat: Oklch = {
      l: 0.55 + t * 0.3,
      c: Math.max(0.02, (core[0]?.c ?? 0.12) * (1 - t * 0.8)),
      h: core[0]?.h ?? 200,
    };

    cues.push({
      type: "build-ramp",
      startBeat: stageStart,
      durationBeats: stageLen,
      intensity: Math.min(1, 0.35 + t * (0.35 + strength * 0.15)),
      target: i % 2 === 0 ? "PRIMARY" : "SECONDARY",
      priority: 50,
      color: desat,
      reason: `staged ramp ${i + 1}/${stages}, desaturating toward white`,
    });
    stageStart += stageLen;
  }

  // Pre-drop darkness ends exactly at the impact and never starts negative:
  // a zero/negative preDark emits no blackout instead of a cue that fails
  // validation (or does nothing).
  const preDark = Math.max(0, config.dropPreDarknessBeats);
  const darkStart = Math.max(0, impactBeat - preDark);
  const darkBeats = impactBeat - darkStart;

  if (darkBeats > 0) {
    cues.push({
      type: "blackout",
      startBeat: darkStart,
      durationBeats: darkBeats,
      intensity: 0,
      target: "ALL",
      priority: 96,
      reason: "pre-drop darkness ending exactly at the impact",
    });
  }

  const impactBeats = envelopeToBeats({ kind: "ms", ms: config.impactDefaultMs }, bpm);

  const saturated: Oklch = {
    l: 0.65,
    c: Math.min(0.25, 0.12 + strength * 0.1 + style.colorSaturation * 0.05),
    h: occurrence % 2 === 1 ? (core[1]?.h ?? ((core[0]?.h ?? 200) + 120) % 360) : (core[0]?.h ?? 200),
  };

  cues.push({
    type: "white-hit",
    startBeat: impactBeat,
    durationBeats: Math.max(0.05, impactBeats),
    intensity: 1,
    target: "ALL",
    priority: 100,
    color: { l: 0.95, c: 0.01, h: 0 },
    reason: "drop impact: white hit",
  });
  // The burst takes its share of the 16-beat post-impact window (spec 36:
  // quantized burst, then saturated body) and the body keeps the rest, at
  // least 4 beats, so an oversized burst cannot collapse it; both cues use
  // the same clamped value so they tile without a gap or overlap.
  const burstBeats = Math.min(12, Math.max(0.5, config.dropBurstBeats));
  const burstStart = impactBeat + Math.max(0.05, impactBeats);
  cues.push({
    type: "drop-pattern",
    startBeat: burstStart,
    durationBeats: burstBeats,
    intensity: 0.9,
    target: "ALL",
    priority: 90,
    color: saturated,
    reason: "quantized burst after the impact",
  });
  cues.push({
    type: "drop-pattern",
    startBeat: burstStart + burstBeats,
    durationBeats: Math.max(4, 16 - burstBeats),
    intensity: 0.85,
    target: occurrence % 2 === 1 ? "SECONDARY" : "PRIMARY",
    priority: 61,
    color: saturated,
    reason: occurrence % 2 === 1 ? "second drop varies the target" : "saturated drop body",
  });

  return { cues, staged: stages };
}

export function fakeDropHold(
  fakeBeat: number,
  actualBeat: number,
  preDarkBeats = 0,
): ContrastCue[] {
  // The real drop program already blackouts the beats before its impact, so
  // the fake hold stops where that blackout starts (actualBeat - preDark);
  // its priority matches that blackout (96) so restraint sees one family and
  // the two can never overlap as competing exclusives.
  const holdEnd = Math.max(fakeBeat, actualBeat - Math.max(0, preDarkBeats));
  const span = holdEnd - fakeBeat;

  if (span <= 0) return [];

  return [
    {
      type: "blackout",
      startBeat: fakeBeat,
      durationBeats: span,
      intensity: 0,
      target: "ALL",
      priority: 96,
      reason: "fake drop: hold darkness, fire nothing at the fake impact",
    },
  ];
}

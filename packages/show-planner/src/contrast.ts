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
  _style: PlannerStyle,
  _config: PlannerConfigSnapshot,
  core: readonly Oklch[],
): ContrastCue[] {
  const narrow = core[0] ?? { l: 0.5, c: 0.08, h: 220 };
  return [
    {
      type: "breakdown-look",
      startBeat,
      durationBeats: Math.max(0, endBeat - startBeat),
      intensity: 0.22,
      target: "AMBIENT",
      priority: 40,
      color: narrow,
      reason: "breakdown: low brightness, few segments, narrow palette",
    },
    {
      type: "texture-hold",
      startBeat,
      durationBeats: Math.max(0, endBeat - startBeat),
      intensity: 0.15,
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
  const span = Math.max(4, impactBeat - buildStart);
  const want = config.dropStages.length;
  const stages = Math.max(2, Math.min(want, Math.floor(span / 4)));
  const stageLen = span / stages;
  for (let i = 0; i < stages; i++) {
    const start = buildStart + i * stageLen;
    const t = (i + 1) / stages;
    const desat: Oklch = {
      l: 0.55 + t * 0.3,
      c: Math.max(0.02, (core[0]?.c ?? 0.12) * (1 - t * 0.8)),
      h: core[0]?.h ?? 200,
    };
    cues.push({
      type: "build-ramp",
      startBeat: start,
      durationBeats: stageLen,
      intensity: 0.35 + t * (0.35 + strength * 0.15),
      target: i % 2 === 0 ? "PRIMARY" : "SECONDARY",
      priority: 50,
      color: desat,
      reason: `staged ramp ${i + 1}/${stages}, desaturating toward white`,
    });
  }
  const preDark = config.dropPreDarknessBeats;
  cues.push({
    type: "blackout",
    startBeat: impactBeat - preDark,
    durationBeats: preDark,
    intensity: 0,
    target: "ALL",
    priority: 96,
    reason: "pre-drop darkness ending exactly at the impact",
  });
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
  cues.push({
    type: "drop-pattern",
    startBeat: impactBeat + Math.max(0.05, impactBeats),
    durationBeats: config.dropBurstBeats,
    intensity: 0.9,
    target: "ALL",
    priority: 90,
    color: saturated,
    reason: "quantized burst after the impact",
  });
  cues.push({
    type: "drop-pattern",
    startBeat: impactBeat + Math.max(0.05, impactBeats) + config.dropBurstBeats,
    durationBeats: Math.max(4, 16 - config.dropBurstBeats),
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
): ContrastCue[] {
  const span = Math.max(1, actualBeat - fakeBeat);
  return [
    {
      type: "blackout",
      startBeat: fakeBeat,
      durationBeats: span,
      intensity: 0,
      target: "ALL",
      priority: 95,
      reason: "fake drop: hold darkness, fire nothing at the fake impact",
    },
  ];
}

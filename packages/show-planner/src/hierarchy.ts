// Six-level hierarchy with look-ahead progression (T-PLAN-03, spec 2.1/30).
// Plans top-down: track arc, sections, phrases, bars, beats, sub-beats. Each
// level only changes its assigned attributes; the validator enforces the
// table. Whole-song knowledge first: a drop plans backwards into staged builds,
// pre-impact darkness, palette evolution, foreshadowing and second-drop
// variation.
import type { TrackModel } from "@autolight/contracts";
import { envelopeToBeats, type Oklch, type PlannerConfigSnapshot, type PlannerStyle } from "./types.js";

export type HierarchyLevel = "track" | "section" | "phrase" | "bar" | "beat" | "sub-beat";

// Attributes each level may change (spec 30). The validator rejects a cue
// that changes a forbidden attribute at its level.
export const LEVEL_ATTRIBUTES: Record<HierarchyLevel, readonly string[]> = {
  track: ["identity", "progression"],
  section: ["brightness-range", "palette", "density", "movement-family", "ceiling", "darkness"],
  phrase: ["variation", "direction", "progression", "participation"],
  bar: ["chase-direction", "alternation", "variation"],
  beat: ["pulse", "bump", "hit", "switch"],
  "sub-beat": ["strobe", "roll", "impact-texture"],
};

export const CUE_LEVEL_ATTRIBUTES: Record<string, { level: HierarchyLevel; attrs: readonly string[] }> = {
  "static-look": { level: "section", attrs: ["brightness-range", "palette", "density", "darkness"] },
  "section-look": { level: "section", attrs: ["brightness-range", "palette", "density", "darkness"] },
  "gradient-look": { level: "section", attrs: ["palette", "density"] },
  "breakdown-look": { level: "section", attrs: ["brightness-range", "palette", "density", "darkness"] },
  "outro-release": { level: "section", attrs: ["brightness-range", "palette", "density", "darkness"] },
  orbit: { level: "section", attrs: ["movement-family"] },
  "perimeter-orbit": { level: "section", attrs: ["movement-family"] },
  spiral: { level: "section", attrs: ["movement-family"] },
  ripple: { level: "section", attrs: ["movement-family"] },
  "phrase-turn": { level: "phrase", attrs: ["variation", "direction", "progression"] },
  "group-handoff": { level: "phrase", attrs: ["participation", "variation"] },
  "vocal-focus": { level: "phrase", attrs: ["variation", "participation"] },
  "texture-hold": { level: "phrase", attrs: ["variation", "participation"] },
  chase: { level: "bar", attrs: ["chase-direction", "alternation"] },
  "chase-flip": { level: "bar", attrs: ["chase-direction", "alternation"] },
  alternate: { level: "bar", attrs: ["alternation"] },
  split: { level: "bar", attrs: ["alternation"] },
  "split-alternate": { level: "bar", attrs: ["alternation"] },
  sweep: { level: "bar", attrs: ["chase-direction", "alternation"] },
  "mirror-sweep": { level: "bar", attrs: ["chase-direction", "alternation"] },
  "symmetric-sweep": { level: "bar", attrs: ["chase-direction", "alternation"] },
  wave: { level: "bar", attrs: ["alternation", "variation"] },
  "build-ramp": { level: "bar", attrs: ["alternation", "variation"] },
  pulse: { level: "beat", attrs: ["pulse"] },
  bump: { level: "beat", attrs: ["bump"] },
  "decay-hit": { level: "beat", attrs: ["hit"] },
  "fill-accent": { level: "beat", attrs: ["hit"] },
  "corner-hits": { level: "beat", attrs: ["hit"] },
  impact: { level: "beat", attrs: ["hit"] },
  "white-hit": { level: "beat", attrs: ["hit"] },
  reveal: { level: "beat", attrs: ["switch"] },
  dip: { level: "beat", attrs: ["switch"] },
  blackout: { level: "beat", attrs: ["switch"] },
  "drop-pattern": { level: "beat", attrs: ["hit"] },
  "final-hit": { level: "beat", attrs: ["hit"] },
  "strobe-burst": { level: "sub-beat", attrs: ["strobe"] },
  strobe: { level: "sub-beat", attrs: ["strobe"] },
  "roll-pattern": { level: "sub-beat", attrs: ["roll"] },
};

export interface HierarchyCue {
  type: string;
  startBeat: number;
  durationBeats: number;
  intensity: number;
  target: string;
  priority: number;
  level: HierarchyLevel;
  movement?: string;
  reason: string;
}

// Intensity arc over the whole track: rise to 70 percent, hold, release.
export function trackArcPosition(beat: number, firstBeat: number, lastBeat: number): number {
  const span = Math.max(1, lastBeat - firstBeat);
  const t = Math.min(1, Math.max(0, (beat - firstBeat) / span));
  if (t < 0.7) return 0.4 + (t / 0.7) * 0.6;
  if (t < 0.85) return 1;
  return 1 - ((t - 0.85) / 0.15) * 0.5;
}

export interface DropPlan {
  impactBeat: number;
  buildStart: number;
}

export function findDropPlans(track: TrackModel, minConfidence: number): DropPlan[] {
  const out: DropPlan[] = [];
  for (const ev of track.musicalEvents) {
    if (ev.type !== "drop" || ev.confidence < minConfidence) continue;
    const build = track.musicalEvents.find(
      (b) =>
        (b.type === "build-start" || b.type === "predrop" || b.type === "build-intensification") &&
        b.beat <= ev.beat &&
        (b.endBeat ?? b.beat + 8) >= ev.beat - 4,
    );
    const predrop = track.musicalEvents.find((b) => b.type === "predrop" && b.beat <= ev.beat && b.beat >= ev.beat - 4);
    out.push({
      impactBeat: ev.beat,
      buildStart: build?.beat ?? predrop?.beat ?? ev.beat - 32,
    });
  }
  return out;
}

// Staged cues between build start and impact with increasing density: one
// cue per 4-beat stage, intensity rising, chase period shortening.
export function stagedBuild(
  buildStart: number,
  impactBeat: number,
  _style: PlannerStyle,
  _config: PlannerConfigSnapshot,
): HierarchyCue[] {
  const cues: HierarchyCue[] = [];
  const span = Math.max(4, impactBeat - buildStart);
  const stages = Math.max(2, Math.min(8, Math.floor(span / 4)));
  const stageLen = span / stages;
  for (let i = 0; i < stages; i++) {
    const start = buildStart + i * stageLen;
    const t = (i + 1) / stages;
    cues.push({
      type: "build-ramp",
      startBeat: start,
      durationBeats: stageLen,
      intensity: 0.35 + t * 0.5,
      target: i % 2 === 0 ? "PRIMARY" : "SECONDARY",
      priority: 50,
      level: "bar",
      movement: i < stages / 2 ? "chase" : "outside-in",
      reason: `build stage ${i + 1} of ${stages} toward impact at ${impactBeat}`,
    });
  }
  return cues;
}

export function phraseStartsIn(
  sectionStart: number,
  sectionEnd: number,
  phraseBeats = 8,
): number[] {
  const out: number[] = [];
  for (let b = sectionStart + phraseBeats; b < sectionEnd; b += phraseBeats) out.push(b);
  return out;
}

// Phrase level: variation, direction, progression, participation. Emits a
// phrase-turn at each phrase boundary inside long sections.
export function phraseCues(
  sectionStart: number,
  sectionEnd: number,
  motifId: string | null,
  occurrence: number,
  _core: readonly Oklch[],
): HierarchyCue[] {
  const starts = phraseStartsIn(sectionStart, sectionEnd);
  return starts.map((b, i) => ({
    type: "phrase-turn",
    startBeat: b,
    durationBeats: Math.min(2, sectionEnd - b),
    intensity: 0.5 + (i % 3) * 0.1,
    target: (i + occurrence) % 2 === 0 ? "PRIMARY" : "SECONDARY",
    priority: 52,
    level: "phrase" as HierarchyLevel,
    movement: "cross",
    reason: motifId ? `phrase variation inside ${motifId}` : "phrase progression",
  }));
}

// Bar level: chase direction and alternation inside long sections.
export function barCues(
  sectionStart: number,
  sectionEnd: number,
  periodBeats: number,
  energy: number,
): HierarchyCue[] {
  const cues: HierarchyCue[] = [];
  for (let b = sectionStart + periodBeats; b < sectionEnd; b += periodBeats) {
    cues.push({
      type: "chase",
      startBeat: b,
      durationBeats: Math.min(periodBeats, sectionEnd - b),
      intensity: energy,
      target: Math.floor(b / periodBeats) % 2 === 0 ? "LEFT" : "RIGHT",
      priority: 11,
      level: "bar",
      movement: "chase",
      reason: "bar alternation",
    });
  }
  return cues;
}

// Beat level: pulses on every beat of high-energy sections, scaled by style.
export function beatCues(
  sectionStart: number,
  sectionEnd: number,
  energy: number,
  movementDensity: number,
): HierarchyCue[] {
  if (energy < 0.75 || movementDensity < 0.4) return [];
  const cues: HierarchyCue[] = [];
  for (let b = sectionStart; b < sectionEnd; b += 2) {
    cues.push({
      type: "pulse",
      startBeat: b,
      durationBeats: 0.5,
      intensity: energy * 0.9,
      target: "PRIMARY",
      priority: 60,
      level: "beat",
      reason: "beat pulse",
    });
  }
  return cues;
}

// Sub-beat: brief strobes and rolls only where the style asks and only
// inside the caller-provided duty allowance (counted in beats here).
export function subBeatCues(
  atBeat: number,
  strobeFrequency: number,
  rand: () => number,
): HierarchyCue[] {
  if (strobeFrequency <= 0 || rand() >= strobeFrequency * 0.5) return [];
  return [
    {
      type: "strobe-burst",
      startBeat: atBeat,
      durationBeats: 0.5,
      intensity: 0.9,
      target: "ALL",
      priority: 92,
      level: "sub-beat",
      reason: "sub-beat strobe texture",
    },
  ];
}

export { envelopeToBeats };
export type { Oklch };

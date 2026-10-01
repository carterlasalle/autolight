// Validator and evaluator in production (T-PLAN-10, spec 114/115). The
// validator runs on every compile; the evaluator computes all ten spec 115
// diagnostics. Pathological generations are rejected and the next candidate
// wins (DS-19).
import type {
  CompiledShowPlan,
  PlanCue,
  PlanDiagnostics,
  PlannerConfigSnapshot,
  VenueCapabilityClass,
} from "./types.js";
import { CUE_LEVEL_ATTRIBUTES } from "./hierarchy.js";

export const KNOWN_CUE_TYPES: Record<string, true> = {
  "static-look": true,
  "section-look": true,
  "gradient-look": true,
  pulse: true,
  bump: true,
  "decay-hit": true,
  alternate: true,
  chase: true,
  "chase-flip": true,
  sweep: true,
  "mirror-sweep": true,
  "outside-in": true,
  "inside-out": true,
  split: true,
  wave: true,
  "build-ramp": true,
  "phrase-turn": true,
  "fill-accent": true,
  impact: true,
  "white-hit": true,
  blackout: true,
  dip: true,
  reveal: true,
  "strobe-burst": true,
  strobe: true,
  "roll-pattern": true,
  "drop-pattern": true,
  "breakdown-look": true,
  "vocal-focus": true,
  "outro-release": true,
  orbit: true,
  "perimeter-orbit": true,
  ripple: true,
  "radial-pulse": true,
  "opposed-pulse": true,
  converge: true,
  diverge: true,
  radar: true,
  "split-alternate": true,
  "quadrant-rotate": true,
  "wall-step": true,
  "corner-hits": true,
  fill: true,
  unfill: true,
  "gradient-rotate": true,
  spiral: true,
  breathe: true,
  mirror: true,
  "symmetric-sweep": true,
  "spatial-wipe": true,
  "group-handoff": true,
  "texture-hold": true,
  "final-hit": true,
};

export interface ValidatorHooks {
  readonly knownTypes?: (type: string) => boolean;
  readonly venue?: VenueCapabilityClass;
}

export function validateCompiledPlan(
  plan: CompiledShowPlan,
  durationBeats: number,
  _config: PlannerConfigSnapshot,
  hooks: ValidatorHooks = {},
): string[] {
  const problems: string[] = [];
  const known = hooks.knownTypes ?? ((t: string) => KNOWN_CUE_TYPES[t] === true);
  for (const c of plan.cues) {
    if (!known(c.type)) problems.push(`unknown primitive ${c.type}@${c.startBeat}`);
    if (c.durationBeats < 0) problems.push(`negative duration ${c.type}@${c.startBeat}`);
    if (c.startBeat < 0 || c.startBeat > durationBeats) {
      problems.push(`out-of-range ${c.type}@${c.startBeat}`);
    }
    const rule = CUE_LEVEL_ATTRIBUTES[c.type];
    if (rule !== undefined && rule.level !== c.level) {
      problems.push(`level violation ${c.type}@${c.startBeat} is ${c.level}, expected ${rule.level}`);
    }
  }
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
  // Determinism at arbitrary beats: zero-duration cues other than hits are
  // not evaluable, and NaN positions never are.
  for (const c of plan.cues) {
    if (!Number.isFinite(c.startBeat) || !Number.isFinite(c.durationBeats)) {
      problems.push(`non-deterministic position ${c.type}@${String(c.startBeat)}`);
    }
  }
  // Repeated major white impacts without musical gap justification.
  const whites = plan.cues
    .filter((c) => c.type === "white-hit")
    .sort((a, b) => a.startBeat - b.startBeat);
  const gap = _config.whiteHitMinBeats;
  for (let i = 1; i < whites.length; i++) {
    const prev = whites[i - 1]!;
    const cur = whites[i]!;
    if (cur.startBeat - prev.startBeat < gap && !(cur.justification || cur.reason.includes("musical justification"))) {
      problems.push("repeated white impact without justification white-hit@" + cur.startBeat);
    }
  }
  // No palette-identity repaint faster than the configured floor.
  const looks = plan.cues
    .filter((c) => c.color !== undefined && (c.type === "section-look" || c.type === "static-look"))
    .sort((a, b) => a.startBeat - b.startBeat);
  let lastHue = null;
  let lastBeat = -Infinity;
  for (const c of looks) {
    if (c.color === undefined) continue;
    const key = Math.round(c.color.h) + ":" + c.color.c.toFixed(2);
    if (lastHue !== null && key !== lastHue && c.startBeat - lastBeat < _config.paletteChangeMinBeats) {
      problems.push("palette change every beat (" + c.type + "@" + c.startBeat + ")");
    }
    if (key !== lastHue) { lastHue = key; lastBeat = c.startBeat; }
  }
  const venue = hooks.venue;
  if (venue) {
    for (const c of plan.cues) {
      if (c.capability === "closed-loop" && !venue.topologies.includes("closed-loop")) {
        problems.push(`unsupported capability closed-loop for ${c.type}@${c.startBeat}`);
      }
      if ((c.type === "strobe-burst" || c.type === "strobe") && venue.flags["strobe"] === false) {
        problems.push(`unsupported capability strobe for ${c.type}@${c.startBeat}`);
      }
    }
  }
  return problems;
}

// Palette change count: colour identity changes at section/phrase/motif
// boundaries. A plan that repaints every beat without a marked special
// section is pathological.
export function countPaletteChanges(cues: readonly PlanCue[]): number {
  let n = 0;
  let last: string | null = null;
  // Colour identity lives on section looks only: build ramps desaturate
  // toward white by design and drop bodies vary by occurrence, neither is
  // a palette change. Counting them would punish the drop structure.
  const ordered = [...cues]
    .filter((c) => c.color !== undefined && (c.type === "section-look" || c.type === "static-look"))
    .sort((a, b) => a.startBeat - b.startBeat);
  for (const c of ordered) {
    const key = `${Math.round(c.color!.h)}:${c.color!.c.toFixed(2)}`;
    if (last !== null && key !== last) n++;
    last = key;
  }
  return n;
}

export function evaluateCompiledPlan(
  plan: CompiledShowPlan,
  _config: PlannerConfigSnapshot,
): PlanDiagnostics {
  const cues = plan.cues;
  const beats = (ts: readonly string[]): number =>
    cues.filter((c) => ts.includes(c.type)).reduce((n, c) => n + c.durationBeats, 0);
  const total = Math.max(1, cues.reduce((n, c) => n + c.durationBeats, 0));
  const blackoutBeats = beats(["blackout"]);
  const whiteHits = cues.filter((c) => c.type === "white-hit").length;
  const blackouts = cues.filter((c) => c.type === "blackout").length;
  const strobeBeats = beats(["strobe", "strobe-burst"]);
  const changes = countPaletteChanges(cues);
  const duration = Math.max(
    1,
    ...cues.map((c) => c.startBeat + c.durationBeats),
  );
  const targets = cues.map((c) => c.target);
  const uniq = new Set(targets);
  const entropy =
    uniq.size <= 1
      ? 0
      : [...uniq]
          .map((t) => targets.filter((x) => x === t).length / targets.length)
          .reduce((n, p) => n - p * Math.log2(Math.max(1e-9, p)), 0);
  const sections = plan.sections;
  const means = sections.map((s) => {
    const inSection = cues.filter((c) => c.startBeat >= s.startBeat && c.startBeat < s.endBeat);
    if (!inSection.length) return 0;
    return inSection.reduce((n, c) => n + c.intensity, 0) / inSection.length;
  });
  const contrast =
    means.length > 1 ? Math.max(...means) - Math.min(...means) : 0;
  const ordered = [...cues].sort((a, b) => a.startBeat - b.startBeat);
  const arc =
    ordered.length > 1
      ? ordered.reduce((n, c) => n + c.intensity, 0) / ordered.length
      : 0;
  const motifSizes = plan.recurrence.motifs.map((m) => m.sections.length);
  const recurrence =
    motifSizes.length && cues.length
      ? motifSizes.filter((s) => s > 1).reduce((a, b) => a + b, 0) / Math.max(1, cues.length)
      : 0;
  return {
    activeDensity: Math.min(1, cues.length / Math.max(1, duration / 2)),
    darknessPct: Math.min(1, blackoutBeats / total),
    colourChangeRate: changes / Math.max(1, duration / 32),
    whiteHits,
    blackouts,
    strobeBeats,
    patternRecurrence: Math.min(1, recurrence),
    spatialEntropy: entropy,
    sectionContrast: Math.min(1, Math.max(0, contrast)),
    intensityArc: Math.min(1, Math.max(0, arc)),
  };
}

export function diagnosticsOutOfBounds(
  d: PlanDiagnostics,
  config: PlannerConfigSnapshot,
): string[] {
  const out: string[] = [];
  const entries: Array<[keyof PlanDiagnostics, number]> = [
    ["activeDensity", d.activeDensity],
    ["darknessPct", d.darknessPct],
    ["colourChangeRate", d.colourChangeRate],
    ["whiteHits", d.whiteHits],
    ["blackouts", d.blackouts],
    ["strobeBeats", d.strobeBeats],
    ["patternRecurrence", d.patternRecurrence],
    ["spatialEntropy", d.spatialEntropy],
    ["sectionContrast", d.sectionContrast],
    ["intensityArc", d.intensityArc],
  ];
  for (const [k, v] of entries) {
    const bound = config.evaluationBounds[k];
    if (bound && (v < bound[0] || v > bound[1])) {
      out.push(`${k} ${v.toFixed(3)} outside [${bound[0]}, ${bound[1]}]`);
    }
  }
  return out;
}

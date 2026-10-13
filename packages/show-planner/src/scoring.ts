// Candidate scoring hook (T-PLAN-12, spec 113 / DS-19). Modes: rules
// (deterministic rule output), scored (rules produce candidatesPerSection
// candidates per section, registered evaluators pick), rules-with-veto
// (default: rules output stands unless evaluators flag a pathological
// section, then the next candidate wins). Evaluators are pure functions
// registered by name; the built-ins use spec 115-style section stats. A
// learned evaluator registers later without changing the planner.
import type { PlanDiagnostics } from "./types.js";

export type PlannerMode = "rules" | "scored" | "rules-with-veto";

export interface SectionCandidate {
  readonly index: number;
  readonly cues: number;
  readonly meanIntensity: number;
  readonly darkness: number;
  readonly density: number;
  readonly variant: number;
  readonly seed: string;
  readonly diagnostics?: PlanDiagnostics;
}

export type Evaluator = (c: SectionCandidate) => number;

const REGISTRY: Record<string, Evaluator> = {};

export interface CandidateScore {
  score: number;
  skipped: string[];
}

export interface CandidatePick {
  winner: number;
  vetoed: number[];
}

export function registerEvaluator(name: string, fn: Evaluator): void {
  REGISTRY[name] = fn;
}

export function evaluatorNames(): string[] {
  return Object.keys(REGISTRY).sort();
}

export function clearEvaluators(): void {
  for (const k of Object.keys(REGISTRY)) delete REGISTRY[k];
  registerBuiltins();
}

function registerBuiltins(): void {
  REGISTRY["density"] = (c) => Math.min(1, c.density);
  REGISTRY["darkness-balance"] = (c) => Math.min(1, Math.max(0, 1 - Math.abs(c.darkness - 0.25)));
  REGISTRY["contrast"] = (c) => Math.min(1, c.meanIntensity);
  REGISTRY["diagnostics"] = (c) => {
    const v = c.diagnostics?.sectionContrast;

    if (v === undefined) return 0.5;

    if (!Number.isFinite(v)) return 0.5;

    return Math.min(1, Math.max(0, v));
  };
}

registerBuiltins();

// Veto flags a pathological section candidate: empty, all-dark, or
// all-max-intensity with no variation.
export function vetoCandidate(c: SectionCandidate): string | null {
  if (c.cues === 0) return "empty section";

  if (c.darkness > 0.9 && c.meanIntensity < 0.05) return "all dark with no energy";

  if (c.meanIntensity > 0.99 && c.density > 0.99) return "saturated and densely packed";

  return null;
}

export function scoreCandidate(c: SectionCandidate, evaluators: readonly string[] = evaluatorNames()): CandidateScore {
  let total = 0;
  let n = 0;
  const skipped: string[] = [];

  for (const name of evaluators) {
    const fn = REGISTRY[name];

    if (!fn) {
      skipped.push(name);
      continue;
    }

    total += fn(c);
    n++;
  }

  return { score: n ? total / n : 0, skipped };
}

export function pickCandidate(
  candidates: readonly SectionCandidate[],
  mode: PlannerMode,
  evaluators: readonly string[] = evaluatorNames(),
): CandidatePick {
  if (!candidates.length) return { winner: -1, vetoed: [] };

  if (mode === "rules") return { winner: 0, vetoed: [] };
  const scored = candidates.map((c, i) => ({ i, s: scoreCandidate(c, evaluators).score, veto: vetoCandidate(c) }));

  if (mode === "rules-with-veto") {
    const first = scored[0]!;

    if (first.veto === null) return { winner: 0, vetoed: [] };
    const next = scored.find((s) => s.veto === null);
    const vetoed: number[] = [];

    for (const s of scored) if (s.veto !== null) vetoed.push(s.i);

    if (next) return { winner: next.i, vetoed };

    return { winner: -1, vetoed: scored.map((s) => s.i) };
  }

  const viable = scored.filter((s) => s.veto === null);

  if (!viable.length) return { winner: -1, vetoed: scored.map((s) => s.i) };

  let best = viable[0]!;

  for (const s of viable) {
    if (s.s > best.s) best = s;
  }

  return {
    winner: best.i,
    vetoed: scored.flatMap((s) => (s.veto !== null ? [s.i] : [])),
  };
}

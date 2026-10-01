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
}

export type Evaluator = (c: SectionCandidate) => number;

const REGISTRY: Record<string, Evaluator> = {};

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
  REGISTRY["darkness-balance"] = (c) => 1 - Math.abs(c.darkness - 0.25);
  REGISTRY["contrast"] = (c) => Math.min(1, c.meanIntensity);
  REGISTRY["diagnostics"] = (c: SectionCandidate & { diagnostics?: PlanDiagnostics }) =>
    c.diagnostics ? Math.min(1, Math.max(0, c.diagnostics.sectionContrast)) : 0.5;
}

registerBuiltins();

// Veto flags a pathological section candidate: empty, all-dark, or
// all-max-intensity with no variation.
export function vetoCandidate(c: SectionCandidate): string | null {
  if (c.cues === 0) return "empty section";
  if (c.darkness > 0.9 && c.meanIntensity < 0.05) return "all dark with no energy";
  if (c.meanIntensity > 0.99 && c.density > 0.99) return "saturated with no variation";
  return null;
}

export function scoreCandidate(c: SectionCandidate, evaluators: readonly string[] = evaluatorNames()): number {
  let total = 0;
  let n = 0;
  for (const name of evaluators) {
    const fn = REGISTRY[name];
    if (!fn) continue;
    total += fn(c);
    n++;
  }
  return n ? total / n : 0;
}

export function pickCandidate(
  candidates: readonly SectionCandidate[],
  mode: PlannerMode,
  evaluators: readonly string[] = evaluatorNames(),
): { winner: number; vetoed: number[] } {
  if (!candidates.length) return { winner: -1, vetoed: [] };
  if (mode === "rules") return { winner: 0, vetoed: [] };
  const scored = candidates.map((c, i) => ({ i, s: scoreCandidate(c, evaluators), veto: vetoCandidate(c) }));
  if (mode === "rules-with-veto") {
    const first = scored[0]!;
    if (first.veto === null) return { winner: 0, vetoed: [] };
    const next = scored.find((s) => s.veto === null);
    if (next) return { winner: next.i, vetoed: scored.filter((s) => s.veto !== null).map((s) => s.i) };
    return { winner: 0, vetoed: scored.slice(1).map((s) => s.i) };
  }
  let best = scored[0]!;
  for (const s of scored) {
    if (s.veto !== null) continue;
    if (s.s > best.s || best.veto !== null) best = s;
  }
  return {
    winner: best.i,
    vetoed: scored.filter((s) => s.i !== best.i && s.veto !== null).map((s) => s.i),
  };
}

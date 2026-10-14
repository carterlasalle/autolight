// T-PLAN-12: candidate scoring hook DS-19 (P-113).
import { describe, expect, it } from "vitest";
import { clearEvaluators, pickCandidate, registerEvaluator, scoreCandidate, vetoCandidate } from "./scoring.js";

describe("T-PLAN-12 scoring hook (P-113)", () => {
  it("rules mode is deterministic and ignores evaluators", () => {
    clearEvaluators();
    // The registered evaluator's maximum sits at index 2; rules must still win 0.
    registerEvaluator("anti-rules", (c) => c.index);
    const cs = [0, 1, 2].map((i) => ({ index: i, cues: 4, meanIntensity: 0.9 - i * 0.3, darkness: 0.2, density: 0.5, variant: i, seed: "s" + i }));
    expect(pickCandidate(cs, "rules").winner).toBe(0);
    expect(pickCandidate(cs, "rules").winner).toBe(0);
    clearEvaluators();
  });
  it("scored mode picks by registered evaluators, deterministically", () => {
    clearEvaluators();
    // "loud" contradicts the builtins: cs[0] has the highest density but the
    // lowest meanIntensity, so only the registered hook can make cs[2] win.
    registerEvaluator("loud", (c) => c.meanIntensity);
    const cs = [0, 1, 2].map((i) => ({ index: i, cues: 4, meanIntensity: 0.2 + i * 0.3, darkness: 0.2, density: 0.9 - i * 0.3, variant: i, seed: "s" + i }));
    expect(scoreCandidate(cs[2]!, ["loud"]).score).toBeGreaterThan(scoreCandidate(cs[0]!, ["loud"]).score);
    expect(pickCandidate(cs, "scored", ["loud"]).winner).toBe(2);
    expect(pickCandidate(cs, "scored", ["loud"]).winner).toBe(2);
  });
  it("rules-with-veto replaces a pathological winner with the next candidate", () => {
    clearEvaluators();
    const ok = { index: 0, cues: 0, meanIntensity: 0, darkness: 0, density: 0, variant: 0, seed: "a" };
    const good = { index: 1, cues: 4, meanIntensity: 0.6, darkness: 0.2, density: 0.5, variant: 1, seed: "b" };
    expect(vetoCandidate(ok)).not.toBe(null);
    const r = pickCandidate([ok, good], "rules-with-veto");
    expect(r.winner).toBe(1);
    expect(r.vetoed).toContain(0);
  });
  it("a learned evaluator registers later without changing the planner", () => {
    clearEvaluators();
    const cs = [{ index: 0, cues: 2, meanIntensity: 0.9, darkness: 0.2, density: 0.5, variant: 0, seed: "a" }, { index: 1, cues: 2, meanIntensity: 0.2, darkness: 0.2, density: 0.6, variant: 1, seed: "b" }];
    // Builtins alone prefer cs[0] (contrast margin beats the density margin).
    expect(pickCandidate(cs, "scored").winner).toBe(0);
    registerEvaluator("learned-x", (c) => c.density * 2);
    // Registration alone must not flip the default winner: the combined pool
    // still prefers cs[0].
    expect(pickCandidate(cs, "scored").winner).toBe(0);
    // The filter argument is exercised: learned-x alone prefers cs[1], so
    // ignoring the filter (using the combined pool) would return 0, not 1.
    expect(pickCandidate(cs, "scored", ["learned-x"]).winner).toBe(1);
  });
});

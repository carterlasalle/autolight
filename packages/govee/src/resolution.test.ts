// T-GOV-15 resolution tests (P-53-resolution): auto picks the highest
// confirmed count that meets the target, falls back to grouped when native
// is too slow, passes explicit modes through, and refuses empty input.
// The ceiling table mirrors the toolkit lan.md section 1 shape (rate falls
// with zone count); no hardware claim.
import { describe, expect, it } from "vitest";
import { selectResolution } from "./resolution.js";

/** Toolkit-style ceiling: the rate for the nearest key at or below zones. */
function ceilingFor(table: Record<number, number>, fallback: number): (zones: number) => number {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  return (zones: number): number => {
    let out = fallback;
    for (const key of keys) {
      if (zones >= key) out = table[key] ?? out;
    }
    return out;
  };
}

const CEILING = { 20: 40, 60: 25, 120: 20 };

describe("selectResolution", () => {
  it("auto picks the highest confirmed count that meets the target", () => {
    const decision = selectResolution({
      logical: 14,
      native: 20,
      stableFpsFor: ceilingFor(CEILING, 10),
      targetHz: 30,
    });
    expect(decision.kind).toBe("native");
    expect(decision.zones).toBe(20);
    expect(decision.meetsTarget).toBe(true);
    expect(decision.reason).toContain("native 20");
  });

  it("auto picks grouped when native is too slow, and says why", () => {
    const decision = selectResolution({
      logical: null,
      native: 120,
      stableFpsFor: ceilingFor(CEILING, 10),
      targetHz: 30,
    });
    expect(decision.kind).toBe("grouped");
    expect(decision.zones).toBe(40);
    expect(decision.meetsTarget).toBe(true);
    expect(decision.reason).toContain("120");
    expect(decision.reason).toContain("below target");
    expect(decision.reason).toContain("grouped 40");
    expect(decision.candidates.length).toBeGreaterThan(2);
  });

  it("an explicit mode passes through even below target, labelled as explicit", () => {
    const decision = selectResolution({
      logical: null,
      native: 120,
      stableFpsFor: ceilingFor(CEILING, 10),
      targetHz: 30,
      mode: "native",
    });
    expect(decision.kind).toBe("native");
    expect(decision.zones).toBe(120);
    expect(decision.meetsTarget).toBe(false);
    expect(decision.reason).toContain("explicit choice");
  });

  it("refuses input with no confirmed count, and a mode with none", () => {
    expect(() => selectResolution({
      logical: null,
      native: null,
      stableFpsFor: ceilingFor(CEILING, 10),
      targetHz: 30,
    })).toThrow(RangeError);
    expect(() => selectResolution({
      logical: 14,
      native: null,
      stableFpsFor: ceilingFor(CEILING, 10),
      targetHz: 30,
      mode: "native",
    })).toThrow(RangeError);
  });
});

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

  it("considers every confirmed kind and picks the highest count that meets the target", () => {
    const decision = selectResolution({
      logical: 20,
      native: 120,
      stableFpsFor: ceilingFor(CEILING, 10),
      targetHz: 30,
    });

    // Candidates span kinds (native 120 is fastest-count but below target,
    // the grouped ladder starts at 60 below target, and logical 20 meets
    // it); the pick is the largest count that meets, by zone order.
    const find = (kind: string): (typeof decision.candidates)[number] | undefined => decision.candidates.find((c) => c.kind === kind);

    expect(find("native")).toMatchObject({ zones: 120, meetsTarget: false });
    expect(find("grouped")).toMatchObject({ zones: 60, meetsTarget: false });
    expect(find("logical")).toMatchObject({ zones: 20, meetsTarget: true });
    expect(decision.kind).toBe("grouped");
    expect(decision.zones).toBe(40);
    expect(decision.meetsTarget).toBe(true);
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
    // The full reason string, not one substring: exact routing text.
    expect(decision.reason).toBe("grouped 40 zones at 40 Hz stable meets target 30 Hz (highest count that does) (native 120 zones at 20 Hz stable is below target 30 Hz)");
    // Candidate rows are distinct (no duplicated kind:zones entries).
    const rows = decision.candidates.map((c) => `${c.kind}:${c.zones}`);

    expect(rows).toContain("native:120");
    expect(rows).toContain("grouped:40");
    expect(new Set(rows).size).toBe(rows.length);
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
    // The two branches are distinguished by their messages, and the target
    // guard has its own: one message per failure, never a bare RangeError.
    expect(() => selectResolution({
      logical: null,
      native: null,
      stableFpsFor: ceilingFor(CEILING, 10),
      targetHz: 30,
    })).toThrow("selectResolution needs at least one confirmed count (logical or native)");
    expect(() => selectResolution({
      logical: 14,
      native: null,
      stableFpsFor: ceilingFor(CEILING, 10),
      targetHz: 30,
      mode: "native",
    })).toThrow("resolution native has no confirmed zone count");
    expect(() => selectResolution({
      logical: 20,
      native: null,
      stableFpsFor: ceilingFor(CEILING, 10),
      targetHz: Number.NaN,
    })).toThrow(/finite targetHz/);
  });
});

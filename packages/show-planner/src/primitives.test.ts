import { describe, expect, it } from "vitest";
import { isPrimitiveName, requirePrimitive, checkTopology, checkFixtureRate, PRIMITIVE_REGISTRY, SPATIAL_PRIMITIVES, SPEC_PRIMITIVES, UnknownPrimitiveError } from "./primitives.js";

describe("T-PLAN-04 primitive library", () => {
  it("registers every spec primitive plus the spatial set", () => {
    for (const name of [...SPEC_PRIMITIVES, ...SPATIAL_PRIMITIVES]) {
      // Non-null and self-named, not merely defined: a null mapping fails.
      expect(PRIMITIVE_REGISTRY[name]?.name, name).toBe(name);
      expect(isPrimitiveName(name)).toBe(true);
    }

    // The key set IS the union: an orphan or mismatched entry fails.
    expect(new Set(Object.keys(PRIMITIVE_REGISTRY))).toEqual(new Set([...SPEC_PRIMITIVES, ...SPATIAL_PRIMITIVES]));
    expect(SPEC_PRIMITIVES).toHaveLength(27);
    expect(SPATIAL_PRIMITIVES).toHaveLength(23);
  });

  it("declares a coordinate system, energy, sections and capability needs per primitive", () => {
    for (const meta of Object.values(PRIMITIVE_REGISTRY)) {
      expect(meta.coordinate).toBeTruthy();
      expect(meta.sections.length).toBeGreaterThan(0);
      expect(["low", "mid", "high"]).toContain(meta.energy);
    }

    expect(PRIMITIVE_REGISTRY["Orbit"]!.coordinate).toBe("s");
    expect(PRIMITIVE_REGISTRY["Orbit"]!.needsClosedOrIndependent).toBe(true);
  });
  it("accepts kebab-case spellings and legacy section-look and chase-flip", () => {
    expect(requirePrimitive("orbit").name).toBe("Orbit");
    expect(requirePrimitive("split-alternate").name).toBe("SplitAlternate");
    expect(requirePrimitive("section-look").name).toBe("StaticLook");
    expect(requirePrimitive("chase-flip").name).toBe("Chase");
  });

  it("rejects unknown primitive types with a typed error, not a silent skip", () => {
    expect(() => requirePrimitive("Nope")).toThrow(UnknownPrimitiveError);
    expect(isPrimitiveName("Nope")).toBe(false);
    // Prototype members are not primitives: "toString" must never resolve.
    expect(isPrimitiveName("toString")).toBe(false);
    expect(isPrimitiveName("constructor")).toBe(false);
    expect(() => requirePrimitive("toString")).toThrow(UnknownPrimitiveError);
  });

  it("gates orbits on topology and strobes on fixture rate", () => {
    expect(checkTopology("Orbit", "split-mirrored")).toMatch(/closed loop/);
    // Every topology the source rejects for closed-or-independent orbits.
    expect(checkTopology("Orbit", "point")).toMatch(/closed loop/);
    expect(checkTopology("Orbit", "vertical-line")).toMatch(/closed loop/);
    expect(checkTopology("Orbit", "closed-loop")).toBeNull();
    expect(checkTopology("Breathe", "split-mirrored")).toBeNull();
    expect(checkFixtureRate("StrobeBurst", 10)).toMatch(/at least 24/);
    // The exact boundary qualifies (>=), one below it fails.
    expect(checkFixtureRate("StrobeBurst", 24)).toBeNull();
    expect(checkFixtureRate("StrobeBurst", 23.9)).toMatch(/at least 24/);
    // An unknown rate cannot prove a 24 Hz primitive: it must fail loudly.
    expect(checkFixtureRate("StrobeBurst", null)).toMatch(/unknown/);
  });
});

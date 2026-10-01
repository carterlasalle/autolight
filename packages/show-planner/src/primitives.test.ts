import { describe, expect, it } from "vitest";
import { isPrimitiveName, parsePrimitiveParams, requirePrimitive, checkTopology, checkFixtureRate, PRIMITIVE_REGISTRY, SPATIAL_PRIMITIVES, SPEC_PRIMITIVES, UnknownPrimitiveError } from "./primitives.js";

describe("T-PLAN-04 primitive library", () => {
  it("registers every spec primitive plus the spatial set", () => {
    for (const name of [...SPEC_PRIMITIVES, ...SPATIAL_PRIMITIVES]) {
      expect(PRIMITIVE_REGISTRY[name], name).toBeDefined();
      expect(isPrimitiveName(name)).toBe(true);
    }
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
    expect(() => requirePrimitive("Nope")).toThrowError(UnknownPrimitiveError);
    expect(isPrimitiveName("Nope")).toBe(false);
  });

  it("gates orbits on topology and strobes on fixture rate", () => {
    expect(checkTopology("Orbit", "split-mirrored")).toMatch(/closed loop/);
    expect(checkTopology("Orbit", "closed-loop")).toBeNull();
    expect(checkTopology("Breathe", "split-mirrored")).toBeNull();
    expect(checkFixtureRate("StrobeBurst", 10)).toMatch(/at least 24/);
    expect(checkFixtureRate("StrobeBurst", 30)).toBeNull();
  });
});

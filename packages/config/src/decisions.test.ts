import { describe, expect, it } from "vitest";
import { KEYS } from "./registry.js";
import { DECISIONS, DECISION_IDS, decisionFor, decisionForConfigKey, decisionModes } from "./decisions.js";

// T-CFG-06: every DS-01..DS-36 switch has its options, its combined mode, its
// default and the measurements that inform the choice, and a bound registry key
// whenever the switch is a runtime key.

const knownKeys = new Set(KEYS.map((k) => k.key));

describe("decision switch metadata", () => {
  it("covers DS-01 to DS-36 contiguously", () => {
    expect(DECISION_IDS).toHaveLength(36);
    for (let i = 1; i <= 36; i += 1) {
      const id = `DS-${String(i).padStart(2, "0")}`;
      expect(decisionFor(id).ds).toBe(id);
    }
    expect(() => decisionFor("DS-99")).toThrow(/unknown-decision/);
  });

  it("documents every option with pros, cons and requirements", () => {
    for (const decision of DECISIONS) {
      expect(decision.options.length, decision.ds).toBeGreaterThanOrEqual(1);
      expect(decision.measurements.length, decision.ds).toBeGreaterThanOrEqual(1);
      expect(decision.tasks.length, decision.ds).toBeGreaterThanOrEqual(1);
      expect(decision.title.length, decision.ds).toBeGreaterThan(0);
      for (const option of decision.options) {
        expect(option.summary.length, `${decision.ds}:${option.id}`).toBeGreaterThan(0);
        expect(option.pros.length, `${decision.ds}:${option.id}`).toBeGreaterThan(0);
        expect(option.cons.length, `${decision.ds}:${option.id}`).toBeGreaterThan(0);
      }
      // 36 excepted: the only switch with a single option is the build-time one.
      if (decision.ds !== "DS-30") expect(decision.options.length, decision.ds).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps the default reachable and the combined mode real", () => {
    for (const decision of DECISIONS) {
      const ids = decision.options.map((o) => o.id);
      const reachable = ids.includes(decision.defaultMode) || decision.defaultMode === decision.combined;
      expect(reachable, `${decision.ds} default ${decision.defaultMode}`).toBe(true);
      if (decision.combined !== null) expect(decision.combined.length, decision.ds).toBeGreaterThan(0);
      // 25 and 30 are pure choices: there is nothing to combine.
      if (decision.ds === "DS-25" || decision.ds === "DS-30") expect(decision.combined).toBeNull();
    }
  });

  it("binds every runtime switch to a real registry key", () => {
    let bound = 0;
    for (const decision of DECISIONS) {
      if (decision.key === null) continue;
      bound += 1;
      // Placeholder device keys are in the catalog verbatim.
      expect(knownKeys.has(decision.key), `${decision.ds} -> ${decision.key}`).toBe(true);
      expect(decisionForConfigKey(decision.key)?.ds).toBe(decision.ds);
    }
    expect(bound).toBeGreaterThanOrEqual(25);
    expect(decisionForConfigKey("runtime.clock.spinWindowMs")).toBeNull();
  });

  it("names the modes the interface may offer, combined included once", () => {
    expect(decisionModes("DS-09")).toContain("oklab-hue-linear-intensity");
    expect(decisionModes("DS-18")).toEqual(["full", "deck-spatial-dip", "deck-side-blackout", "global-partial-dip", "auto"]);
    expect(new Set(decisionModes("DS-21")).size).toBe(decisionModes("DS-21").length);
    expect(decisionModes("DS-07")).toContain("utility-process-worker");
  });

  it("documents the switches that are not runtime keys", () => {
    const unkeyed = DECISIONS.filter((d) => d.key === null).map((d) => d.ds);
    expect(unkeyed.sort()).toEqual(["DS-16", "DS-20", "DS-22", "DS-23", "DS-26", "DS-27", "DS-30"]);
    expect(decisionFor("DS-30").notes).toMatch(/build-time/i);
    expect(decisionFor("DS-30").options[0]!.id).toBe("electron-builder");
  });
});

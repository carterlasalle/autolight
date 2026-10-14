// Spec 33 cue-to-layer spelling parity: the renderer fallback
// (packages/renderer layerForCue) and the planner canonical
// (packages/show-planner layerForCueName) must agree on every cue type.
// The planner tags cues with its spelling; zod strips unknown keys, so an
// untagged cue falls back to the renderer map — drift between the two is a
// silent wrong layer, exactly what this table forbids. A new cue type must
// be added here with its expected layer.
import { describe, expect, it } from "vitest";
import { layerForCue } from "@autolight/renderer";
// Relative on purpose: the shared spelling module is planner-internal API with
// no barrel export, and tests are exempt from the layer boundary rules.
import { layerForCueName } from "../../../packages/show-planner/src/layers-fallback.js";
import type { RenderLayer } from "@autolight/renderer";

const CASES: ReadonlyArray<readonly [string, RenderLayer]> = [
  ["alternate", "spatial"],
  ["blackout", "exclusive"],
  ["breakdown-look", "base"],
  ["breathe", "spatial"],
  ["build-ramp", "accents"],
  ["bump", "rhythm"],
  ["chase", "spatial"],
  ["chase-flip", "spatial"],
  ["converge", "spatial"],
  ["corner-hits", "spatial"],
  ["decay-hit", "rhythm"],
  ["dip", "exclusive"],
  ["diverge", "spatial"],
  ["drop-pattern", "accents"],
  ["fill", "spatial"],
  ["fill-accent", "accents"],
  ["final-hit", "accents"],
  ["gradient-look", "base"],
  ["gradient-rotate", "spatial"],
  ["group-handoff", "spatial"],
  ["impact", "exclusive"],
  ["mirror", "spatial"],
  ["mirror-sweep", "spatial"],
  ["opposed-pulse", "spatial"],
  ["orbit", "spatial"],
  ["outro-release", "base"],
  ["perimeter-orbit", "spatial"],
  ["phrase-turn", "accents"],
  ["pulse", "rhythm"],
  ["quadrant-rotate", "spatial"],
  ["radar", "spatial"],
  ["radial-pulse", "spatial"],
  ["reveal", "exclusive"],
  ["ripple", "spatial"],
  ["roll-pattern", "rhythm"],
  ["section-look", "base"],
  ["spatial-wipe", "spatial"],
  ["spiral", "spatial"],
  ["split", "spatial"],
  ["split-alternate", "spatial"],
  ["static-look", "base"],
  ["strobe", "exclusive"],
  ["strobe-burst", "exclusive"],
  ["sweep", "spatial"],
  ["symmetric-sweep", "spatial"],
  ["texture-hold", "spatial"],
  ["unfill", "spatial"],
  ["vocal-focus", "accents"],
  ["wall-step", "spatial"],
  ["wave", "spatial"],
  ["white-hit", "exclusive"],
];

describe("layer map parity (spec 33)", () => {
  it("agrees on the layer for every known cue type", () => {
    for (const [type, expected] of CASES) {
      expect(layerForCueName(type), `planner ${type}`).toBe(expected);
      expect(
        layerForCue({ type, startBeat: 0, durationBeats: 1, intensity: 1, target: "ALL", priority: 0 } as Parameters<typeof layerForCue>[0]),
        `renderer ${type}`,
      ).toBe(expected);
    }
  });

  it("falls back to accents for an unknown cue type", () => {
    expect(layerForCueName("never-spelled")).toBe("accents");
  });
});

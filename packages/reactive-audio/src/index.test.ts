import { describe, expect, it } from "vitest";
import { applyOverlay, agcStep, nextLook, type DirectorState } from "./index.js";

describe("reactive-audio", () => {
  it("caps overlay gain", () => {
    // Exact values: an upper bound alone passes for an overlay that never
    // applies (0.9 * 1.2 clamps to exactly 1; 0.5 * 1.2 = 0.6).
    expect(applyOverlay(0.9, 1, 1)).toBe(1);
    expect(applyOverlay(0.5, 1, 1)).toBeCloseTo(0.6, 12);
  });
  it("smooths attacks fast, releases slow", () => {
    const attack = agcStep({ gain: 1, smoothed: 0 }, 1);
    const release = agcStep({ gain: 1, smoothed: 1 }, 0);
    expect(attack.smoothed).toBeCloseTo(0.3);
    expect(release.smoothed).toBeCloseTo(0.95);
    // The asymmetry over a full envelope, not a single step: climbing to
    // 0.99 takes far fewer steps than falling to 0.01.
    let up = { gain: 1, smoothed: 0 };
    let down = { gain: 1, smoothed: 1 };
    let upSteps = 0;
    let downSteps = 0;

    while (up.smoothed < 0.99 && upSteps < 200) {
      up = agcStep(up, 1);
      upSteps += 1;
    }

    while (down.smoothed > 0.01 && downSteps < 200) {
      down = agcStep(down, 0);
      downSteps += 1;
    }

    expect(upSteps).toBeLessThan(downSteps);
  });
  it("rotates adaptive looks with cooldowns", () => {
    const s0: DirectorState = { phraseCount: 0, recentLooks: [], cooldowns: {}, palette: 0 };
    const r1 = nextLook(s0, true, 0);
    const r2 = nextLook(r1.state, true, 0);
    expect(r1.look).not.toBe(r2.look);
    // The full returned state, not just the rotation: history, cooldowns
    // and palette all survive the step.
    expect(r1.state.recentLooks).toEqual(["swell"]);
    expect(r2.state.recentLooks).toEqual(["swell", "shift"]);
    expect(r2.state.cooldowns).toEqual({ swell: 1, shift: 2 });
    expect(r2.state.palette).toBe(0);
    expect(r2.state.phraseCount).toBe(2);
  });
});

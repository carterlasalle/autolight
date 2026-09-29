import { describe, expect, it } from "vitest";
import { applyOverlay, agcStep, nextLook, type DirectorState } from "./index.js";

describe("reactive-audio", () => {
  it("caps overlay gain", () => {
    expect(applyOverlay(0.9, 1, 1)).toBeLessThanOrEqual(1);
    expect(applyOverlay(0.5, 1, 1) - 0.5).toBeLessThanOrEqual(0.2);
  });
  it("smooths attacks fast, releases slow", () => {
    const attack = agcStep({ gain: 1, smoothed: 0 }, 1);
    const release = agcStep({ gain: 1, smoothed: 1 }, 0);
    expect(attack.smoothed).toBeCloseTo(0.3);
    expect(release.smoothed).toBeCloseTo(0.95);
    expect(attack.smoothed - 0).toBeGreaterThan(1 - release.smoothed);
  });
  it("rotates adaptive looks with cooldowns", () => {
    const s0: DirectorState = { phraseCount: 0, recentLooks: [], cooldowns: {}, palette: 0 };
    const r1 = nextLook(s0, true, 0);
    const r2 = nextLook(r1.state, true, 0);
    expect(r1.look).not.toBe(r2.look);
    expect(r2.state.phraseCount).toBe(2);
  });
});

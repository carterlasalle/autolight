// Colour pipeline and per-fixture calibration (T-REND-03, P-49, P-29).
import { describe, expect, it } from "vitest";
import {
  applyIntensityLinear, applyWhiteBalance, fixtureBytes, linearToOklab, linearToSrgbByte,
  oklabToLinear, oklabToOklch, oklchToLinear, oklchToOklab, orientCells,
} from "./color.js";

describe("colour pipeline (T-REND-03)", () => {
  it("round-trips OKLCH through OKLab and linear light", () => {
    const lch = { L: 0.6, C: 0.15, h: 290 };
    const back = oklabToOklch(linearToOklab(oklabToLinear(oklchToOklab(lch))));
    expect(back.L).toBeCloseTo(lch.L, 4);
    expect(back.C).toBeCloseTo(lch.C, 4);
    expect(back.h).toBeCloseTo(lch.h, 3);
  });
  it("renders (255, 0, 90) at 0.30 in linear light (P-49)", () => {
    const srgb = (v: number): number => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const linear = [srgb(255), srgb(0), srgb(90)] as [number, number, number];
    const scaled: [number, number, number] = [linear[0] * 0.3, linear[1] * 0.3, linear[2] * 0.3];
    const bytes = fixtureBytes(scaled);
    const expected: [number, number, number] = [linearToSrgbByte(scaled[0]), linearToSrgbByte(scaled[1]), linearToSrgbByte(scaled[2])];
    expect(bytes).toEqual(expected);
    expect(bytes[0]).toBeGreaterThan(bytes[2]);
    expect(bytes[1]).toBe(0);
    const naive: [number, number, number] = [Math.round(255 * 0.3), 0, Math.round(90 * 0.3)];
    expect(bytes).not.toEqual(naive);
  });
  it("applies intensity without shifting hue", () => {
    const base = oklchToLinear({ L: 0.55, C: 0.18, h: 150 });
    const dim = applyIntensityLinear(base, 0.3);
    expect(oklabToOklch(linearToOklab(dim)).h).toBeCloseTo(oklabToOklch(linearToOklab(base)).h, 2);
    expect(applyIntensityLinear(base, 2)).toEqual(applyIntensityLinear(base, 1));
  });
  it("applies calibration: white balance, ceiling, measured gamma and orientation", () => {
    const linear = oklchToLinear({ L: 0.6, C: 0.12, h: 20 });
    const balanced = applyWhiteBalance(linear, [0.9, 0, 0, 0, 1, 0, 0, 0, 1.1]);
    expect(balanced[0]).toBeCloseTo(linear[0] * 0.9, 9);
    expect(balanced[2]).toBeCloseTo(linear[2] * 1.1, 9);
    const capped = fixtureBytes([1, 1, 1], { brightnessCeiling: 0.5 });
    expect(capped).toEqual(fixtureBytes([0.5, 0.5, 0.5], { brightnessCeiling: 1 }));
    expect(fixtureBytes([0.5, 0.5, 0.5], { gamma: 2.0 })[0]).not.toBe(fixtureBytes([0.5, 0.5, 0.5], { gamma: 2.6 })[0]);
    expect(orientCells([1, 2, 3], "reverse")).toEqual([3, 2, 1]);
    expect(orientCells([1, 2, 3], "forward")).toEqual([1, 2, 3]);
  });
});

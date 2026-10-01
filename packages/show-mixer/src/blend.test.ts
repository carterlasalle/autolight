import { describe, expect, it } from "vitest";
import {
  DEFAULT_BLEND_SPACE,
  blendColors,
  linearToSrgb,
  rgbToOklch,
  srgbToLinear,
  type BlendSpace,
  type Rgb,
} from "./blend.js";

// P-64-violet: the midpoint of cyan and magenta is violet in OKLCH, and the
// weights are never normalized to one, so a lone quiet deck stays quiet.

const CYAN: Rgb = { r: 0, g: 255, b: 255 };
const MAGENTA: Rgb = { r: 255, g: 0, b: 255 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

describe("blend space (P-64)", () => {
  it("mixes cyan and magenta into the violet band in OKLCH", () => {
    const mixed = blendColors([{ rgb: CYAN, weight: 1 }, { rgb: MAGENTA, weight: 1 }], DEFAULT_BLEND_SPACE);
    const { h, L, C } = rgbToOklch(mixed.rgb);
    expect(h, `hue ${h}`).toBeGreaterThan(285);
    expect(h, `hue ${h}`).toBeLessThan(320);
    expect(L).toBeGreaterThan(0.5);
    expect(C).toBeGreaterThan(0.05);
    // The perceptual mix is genuinely between the two sources.
    expect(rgbToOklch(CYAN).h).toBeGreaterThan(190);
    expect(rgbToOklch(CYAN).h).toBeLessThan(200);
    expect(rgbToOklch(MAGENTA).h).toBeGreaterThan(320);
  });

  it("differs between the DS-09 blend spaces", () => {
    const spaces: BlendSpace[] = ["oklab", "linear-rgb", "srgb-legacy", "oklab-hue-linear-intensity"];
    const hues = spaces.map((space) => rgbToOklch(blendColors([{ rgb: CYAN, weight: 1 }, { rgb: MAGENTA, weight: 1 }], space).rgb).h);
    const unique = new Set(hues.map((h) => h.toFixed(1)));
    expect(unique.size).toBeGreaterThan(1);
    // The legacy space is the naive one: it never matches the perceptual mix.
    expect(rgbToOklch(blendColors([{ rgb: CYAN, weight: 1 }, { rgb: MAGENTA, weight: 1 }], "srgb-legacy").rgb).h).not.toBeCloseTo(hues[0]!, 1);
  });

  it("keeps weights unnormalized so a lone quiet deck stays quiet (§64)", () => {
    const lone = blendColors([{ rgb: WHITE, weight: 0.3 }]);
    expect(lone.intensity).toBeCloseTo(0.3, 6);
    expect(lone.rgb.r).toBeGreaterThanOrEqual(148);
    expect(lone.rgb.r).toBeLessThanOrEqual(150);
    const brighter = blendColors([{ rgb: WHITE, weight: 0.6 }]);
    expect(brighter.intensity).toBeCloseTo(0.6, 6);
    expect(brighter.rgb.r).toBeGreaterThan(lone.rgb.r);
    expect(brighter.rgb.r).toBeLessThan(255);
    // Two decks at half weight are as bright as one at full weight, because
    // intensity is the weight total, not a normalized share.
    const pair = blendColors([{ rgb: WHITE, weight: 0.5 }, { rgb: WHITE, weight: 0.5 }]);
    expect(pair.rgb.r).toBe(255);
    expect(blendColors([{ rgb: WHITE, weight: 0 }]).rgb).toEqual({ r: 0, g: 0, b: 0 });
    expect(blendColors([{ rgb: WHITE, weight: 0 }]).intensity).toBe(0);
  });

  it("round-trips sRGB and linear light (spec 49)", () => {
    for (let value = 0; value <= 255; value += 1) {
      expect(Math.abs(linearToSrgb(srgbToLinear(value)) - value)).toBeLessThanOrEqual(1);
    }
    expect(srgbToLinear(0)).toBe(0);
    expect(linearToSrgb(1)).toBe(255);
  });

  it("never returns a channel above 255 or below 0", () => {
    for (const space of ["oklab", "linear-rgb", "srgb-legacy", "oklab-hue-linear-intensity"] as BlendSpace[]) {
      const out = blendColors([{ rgb: MAGENTA, weight: 1 }, { rgb: CYAN, weight: 1 }, { rgb: WHITE, weight: 1 }], space);
      for (const channel of [out.rgb.r, out.rgb.g, out.rgb.b]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });
});

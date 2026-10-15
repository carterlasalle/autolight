import { describe, expect, it } from "vitest";
import { cctToMatterSetupWrites, minIntervalMs, rgbToHsl254, toMatterWrites } from "./mapping.js";

describe("rgbToHsl254", () => {
  it("maps pure red to hue 0, full saturation, full level", () => {
    expect(rgbToHsl254({ r: 255, g: 0, b: 0 })).toEqual({ hue: 0, saturation: 254, level: 254 });
  });
  it("maps pure green near hue 85 in 0..254 units", () => {
    const { hue, saturation } = rgbToHsl254({ r: 0, g: 255, b: 0 });
    expect(hue).toBe(85);
    expect(saturation).toBe(254);
  });
  it("maps mid grey to zero saturation", () => {
    // Full object: the achromatic branch sets hue to 0, and a regression
    // there must fail rather than hide behind a partial match (batch-51).
    expect(rgbToHsl254({ r: 128, g: 128, b: 128 })).toEqual({ hue: 0, saturation: 0, level: 127 });
  });
  it("maps the blue branch and the hue wraparound in 0..254 units", () => {
    // max === b (240deg -> 169.33 -> 169), the negative-ratio wrap (300deg
    // -> 211.67 -> 212), and a mid-wrap value (330deg -> 232.9 -> 233)
    // (batch-51).
    expect(rgbToHsl254({ r: 0, g: 0, b: 255 }).hue).toBe(169);
    expect(rgbToHsl254({ r: 255, g: 0, b: 255 }).hue).toBe(212);
    expect(rgbToHsl254({ r: 255, g: 0, b: 128 }).hue).toBe(233);
  });
});

describe("toMatterWrites", () => {
  it("maps black to a single off write", () => {
    expect(toMatterWrites({ r: 0, g: 0, b: 0 })).toEqual([
      { cluster: "onOff", command: "off", payload: {} },
    ]);
  });
  it("maps red to on plus level plus hue/saturation, every transition 0", () => {
    const writes = toMatterWrites({ r: 255, g: 0, b: 0 });
    expect(writes).toEqual([
      { cluster: "onOff", command: "on", payload: {} },
      { cluster: "levelControl", command: "moveToLevel", payload: { level: 254, transitionDs: 0 } },
      {
        cluster: "colorControl",
        command: "moveToHueAndSaturation",
        payload: { hue: 0, saturation: 254, transitionDs: 0 },
      },
    ]);
  });
  it("never emits a color temperature write in a show-time frame", () => {
    for (const rgb of [{ r: 255, g: 200, b: 100 }, { r: 10, g: 20, b: 30 }, { r: 0, g: 0, b: 1 }]) {
      const writes = toMatterWrites(rgb);

      // Every non-black frame is On + level + hue/saturation: an empty or
      // onOff-only return would satisfy a pure absence check (batch-51).
      expect(writes.map((w) => `${w.cluster}:${w.command}`)).toEqual([
        "onOff:on", "levelControl:moveToLevel", "colorControl:moveToHueAndSaturation",
      ]);
      expect(writes.some((w) => w.command === "moveToColorTemperature")).toBe(false);
    }
  });
});

describe("cctToMatterSetupWrites", () => {
  it("maps 2700K to mireds with the level scaled", () => {
    const writes = cctToMatterSetupWrites(2700, 1);

    // Length and order first, then the elements: a dropped onOff write or a
    // reorder fails here instead of shifting an index assertion (batch-51).
    expect(writes).toHaveLength(3);
    expect(writes.map((w) => w.command)).toEqual(["on", "moveToLevel", "moveToColorTemperature"]);
    expect(writes[1]?.payload["level"]).toBe(254);
    expect(writes[2]).toEqual({
      cluster: "colorControl",
      command: "moveToColorTemperature",
      payload: { colorTemperatureMireds: 370, transitionDs: 0 },
    });
  });
});

describe("minIntervalMs", () => {
  it("converts the default 10 Hz command rate to 100 ms spacing", () => {
    // govee.matter.commandRateHz defaults to 10 (config registry); the pacer
    // math maps that to 100 ms.
    expect(minIntervalMs(10)).toBe(100);
    expect(minIntervalMs(20)).toBe(50);
    // Boundary inputs: a non-positive or non-finite rate means "no pacing"
    // (Infinity), never a zero/negative interval (batch-51).
    expect(minIntervalMs(0)).toBe(Number.POSITIVE_INFINITY);
    expect(minIntervalMs(-5)).toBe(Number.POSITIVE_INFINITY);
    expect(minIntervalMs(Number.NaN)).toBe(Number.POSITIVE_INFINITY);
  });
});

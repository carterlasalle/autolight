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
    const { saturation, level } = rgbToHsl254({ r: 128, g: 128, b: 128 });
    expect(saturation).toBe(0);
    expect(level).toBe(127); // 128/255*254 rounds to 127
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
      for (const w of toMatterWrites(rgb)) {
        expect(w.command).not.toBe("moveToColorTemperature");
      }
    }
  });
});

describe("cctToMatterSetupWrites", () => {
  it("maps 2700K to mireds with the level scaled", () => {
    const writes = cctToMatterSetupWrites(2700, 1);
    expect(writes[2]).toEqual({
      cluster: "colorControl",
      command: "moveToColorTemperature",
      payload: { colorTemperatureMireds: 370, transitionDs: 0 },
    });
    expect(writes[1]?.payload["level"]).toBe(254);
  });
});

describe("minIntervalMs", () => {
  it("converts the default 10 Hz command rate to 100 ms spacing", () => {
    expect(minIntervalMs(10)).toBe(100);
    expect(minIntervalMs(20)).toBe(50);
  });
});

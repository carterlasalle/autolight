import { describe, expect, it } from "vitest";
import { classifyCC, sevenBit } from "./index.js";

describe("flx4", () => {
  it("scales 7-bit", () => { expect(sevenBit(127)).toBe(1); expect(sevenBit(0)).toBe(0); });
  it("classifies known CCs, ignores unknown", () => {
    expect(classifyCC(0x13, 127)).toEqual({ kind: "fader-rise", channel: 1, value: 1 });
    expect(classifyCC(0x77, 64)).toBeNull();
  });
});

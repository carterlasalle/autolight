import { describe, expect, it } from "vitest";
import { classifyCC, compositeDeckState, sevenBit } from "./index.js";

describe("flx4", () => {
  it("scales 7-bit", () => { expect(sevenBit(127)).toBe(1); expect(sevenBit(0)).toBe(0); });
  it("classifies known CCs, ignores unknown", () => {
    expect(classifyCC(0x13, 127)).toEqual({ kind: "fader-rise", channel: 1, value: 1 });
    expect(classifyCC(0x77, 64)).toBeNull();
  });
  it("builds composite deck estimate without overriding playhead", () => {
    const s = compositeDeckState({ deckId: 1, track: { id: "t1" }, playingHint: true, channelFader: 0.8, crossfader: 0.5, playheadSeconds: 30, playRate: 1, receivedAtNs: 0n });
    expect(s.trackId).toBe("t1");
    expect(s.playheadSeconds).toBe(30);
  });
});

import { describe, expect, it } from "vitest";
import { CC, FLX4_CONTROLS, NOTE, classifyCC, compositeDeckState, confirmAudible, sevenBit } from "./index.js";

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
  it("confirms audibility only when both sources agree", () => {
    expect(confirmAudible(0.8, 0.5)).toBe(true);
    expect(confirmAudible(0, 0.5)).toBe(false);
    expect(confirmAudible(null, 0.5)).toBe(true);
  });
  it("keeps the legacy constants on the official values and separates deck 2 by channel", () => {
    expect(NOTE).toEqual({ PLAY_1: 0x0b, PLAY_2: 0x0b, CUE_1: 0x0c, CUE_2: 0x0c, SYNC_1: 0x58, SYNC_2: 0x58 });
    expect(CC).toEqual({ CHANNEL_FADER_1: 0x13, CHANNEL_FADER_2: 0x13, CROSSFADER: 0x1f, FILTER_1: 0x17, FILTER_2: 0x18, TEMPO_1: 0x00, TEMPO_2: 0x00 });
    expect(FLX4_CONTROLS.some((control) => control.id === "deck2.play" && control.status === 0x91 && control.data1 === 0x0b)).toBe(true);
    expect(FLX4_CONTROLS.some((control) => control.id === "deck1.cue" && control.status === 0x90 && control.data1 === 0x0c)).toBe(true);
  });
});

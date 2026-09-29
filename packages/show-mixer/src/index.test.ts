import { describe, expect, it } from "vitest";
import type { TrackIdentity } from "@autolight/contracts";
import { impactOwner, baseWeights, translateBlackout, introductionStage, isExclusive } from "./index.js";
import { makeDeck } from "@autolight/simulator";

const trackA = { id: "a", sourceIds: {} } satisfies TrackIdentity;
const trackB = { id: "b", sourceIds: {} } satisfies TrackIdentity;

describe("show-mixer", () => {
  it("gives impact to the louder deck", () => {
    const a = makeDeck({ channelFader: 1, crossfader: 1, track: trackA });
    const b = makeDeck({ channelFader: 0.1, crossfader: 1, track: trackB });
    expect(impactOwner({ state: a, strength: 1 }, { state: b, strength: 1 })).toBe("a");
  });
  it("returns null when both silent", () => {
    const a = makeDeck({ playing: false });
    const b = makeDeck({ playing: false });
    expect(impactOwner({ state: a, strength: 1 }, { state: b, strength: 1 })).toBeNull();
  });
  it("blends base weights by audibility", () => {
    const a = makeDeck({ channelFader: 1, crossfader: 1, track: trackA });
    const b = makeDeck({ channelFader: 1, crossfader: 1, track: trackB });
    expect(baseWeights(a, b)).toEqual({ a: 0.5, b: 0.5 });
    expect(baseWeights(makeDeck({ playing: false }), makeDeck({ playing: false }))).toEqual({ a: 0, b: 0 });
  });
  it("translates blackout to dip when other deck is loud", () => {
    const cue = { type: "blackout", startBeat: 0, durationBeats: 1, intensity: 0, target: "SIDE", priority: 100 };
    expect(translateBlackout(cue, 0.9).type).toBe("dip");
    expect(translateBlackout(cue, 0.1).type).toBe("blackout");
  });
  it("introduces incoming deck palette before impacts", () => {
    expect(introductionStage(0)).toBe("silent");
    expect(introductionStage(0.1)).toBe("palette");
    expect(introductionStage(0.5)).toBe("rhythm");
    expect(introductionStage(0.9)).toBe("impacts");
  });
  it("marks exclusive impact types", () => {
    expect(isExclusive("white-hit")).toBe(true);
    expect(isExclusive("build-ramp")).toBe(false);
  });
});

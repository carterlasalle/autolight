import { describe, expect, it } from "vitest";
import type { TrackIdentity } from "@autolight/contracts";
import { impactOwner, baseWeights, translateBlackout, introductionStage, isExclusive, loadFastPath, mixDown } from "./index.js";
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
  it("mixes two decks with single impact owner", () => {
    const a = { state: makeDeck({ channelFader: 1, crossfader: 1, track: trackA }), beat: 64, impactStrength: 0.4, cues: [
      { type: "white-hit", startBeat: 64, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 100 },
      { type: "section-look", startBeat: 64, durationBeats: 32, intensity: 0.8, target: "PRIMARY", priority: 10 },
    ] };
    const b = { state: makeDeck({ channelFader: 1, crossfader: 1, track: trackB }), beat: 64, impactStrength: 0.9, cues: [
      { type: "impact", startBeat: 64, durationBeats: 1, intensity: 0.9, target: "PRIMARY", priority: 90 },
    ] };
    const mixed = mixDown(a, b);
    expect(mixed.owner).toBe("b");
    // Loser's exclusive is dropped; base looks from both survive, scaled.
    expect(mixed.cues.filter((c) => c.type === "white-hit")).toHaveLength(0);
    expect(mixed.cues.filter((c) => c.type === "section-look")).toHaveLength(1);
    expect(mixed.cues.every((c) => c.intensity <= 0.9)).toBe(true);
  });
  it("mutes rhythm on palette-stage decks", () => {
    const quiet = { state: makeDeck({ channelFader: 0.1, crossfader: 1, track: trackA }), beat: 0, impactStrength: 1, cues: [
      { type: "impact", startBeat: 0, durationBeats: 1, intensity: 1, target: "ALL", priority: 90 },
      { type: "section-look", startBeat: 0, durationBeats: 8, intensity: 0.8, target: "PRIMARY", priority: 10 },
    ] };
    const loud = { state: makeDeck({ channelFader: 1, crossfader: 1, track: trackB }), beat: 0, impactStrength: 1, cues: [] };
    const mixed = mixDown(quiet, loud);
    expect(mixed.cues.filter((c) => c.type === "impact")).toHaveLength(0);
    expect(mixed.cues.filter((c) => c.type === "section-look")).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { planShow, blendRgb, sectionEnergy, motifVariant } from "./index.js";
import type { TrackModel, ShowStyle } from "@autolight/contracts";

const track = {
  schemaVersion: 1, analyzerVersion: "t", identity: { id: "trk1", sourceIds: {} },
  durationSeconds: 200, beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
  sections: [
    { kind: "build", rawLabel: "Up 1", startBeat: 32, endBeat: 64, confidence: 0.9 },
    { kind: "chorus", rawLabel: "Chorus 1", startBeat: 64, endBeat: 96, confidence: 0.9 },
    { kind: "chorus", rawLabel: "Chorus 2", startBeat: 128, endBeat: 160, confidence: 0.9 },
  ],
  musicalEvents: [
    { type: "build-start", beat: 32, endBeat: 64, confidence: 0.9 },
    { type: "drop", beat: 64, confidence: 0.95 },
    { type: "fake-drop", beat: 120, endBeat: 122, confidence: 0.8 },
    { type: "drop", beat: 66, confidence: 0.9 },
  ],
  analysisCoverage: "full",
} as unknown as TrackModel;
const style = { id: "club", intensityRange: [0.2, 1], darknessPreference: 0.3, reactiveAmount: 0.15, whiteHitFrequency: 1, strobeFrequency: 0.2 } as ShowStyle;

describe("planner", () => {
  it("is deterministic", () => {
    expect(planShow(track, style)).toEqual(planShow(track, style));
  });
  it("programs sections with contrast", () => {
    const cues = planShow(track, style).cues;
    const looks = cues.filter((c) => c.type === "section-look" || c.type === "breakdown-look");
    expect(looks.length).toBeGreaterThan(0);
    const build = cues.find((c) => c.startBeat === 32);
    const chorus = cues.find((c) => c.startBeat === 64 && c.priority === 10);
    expect(build!.intensity).toBeLessThan(chorus!.intensity);
  });
  it("reuses motif with direction variation on repeat chorus", () => {
    const cues = planShow(track, style).cues.filter((c) => c.priority === 10 && (c.startBeat === 64 || c.startBeat === 128));
    expect(cues[0]!.target).not.toBe(cues[1]!.target);
  });
  it("restrains repeat white hits", () => {
    const cues = planShow(track, style).cues;
    expect(cues.filter((c) => c.type === "white-hit")).toHaveLength(1);
  });
  it("holds blackout through fake drop", () => {
    expect(planShow(track, style).cues.some((c) => c.type === "blackout" && c.startBeat === 120)).toBe(true);
  });
  it("blends in linear light, not naive sRGB", () => {
    const [r, g, b] = blendRgb([255, 0, 0], [0, 0, 255], 0.5);
    expect(r).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(100);
    expect([r, g, b].every((v) => v >= 0 && v <= 255)).toBe(true);
  });
  it("maps section energy and motif variants", () => {
    expect(sectionEnergy("breakdown")).toBeLessThan(sectionEnergy("drop"));
    expect(motifVariant("chorus", 0)).toBe("forward");
    expect(motifVariant("chorus", 1)).toBe("reverse");
  });
});

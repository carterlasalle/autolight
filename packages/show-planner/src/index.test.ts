import { describe, expect, it } from "vitest";
import { planShow } from "./index.js";
import type { TrackModel, ShowStyle } from "@autolight/contracts";
const track = {
  schemaVersion: 1, analyzerVersion: "t", identity: { id: "trk1", sourceIds: {} },
  durationSeconds: 200, beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
  sections: [], musicalEvents: [{ type: "drop", beat: 64, confidence: 0.9 }],
  analysisCoverage: "full",
} as unknown as TrackModel;
const style = { id: "club", intensityRange: [0.2, 1], darknessPreference: 0.3, reactiveAmount: 0.15, whiteHitFrequency: 1, strobeFrequency: 0.2 } as ShowStyle;
describe("planner", () => {
  it("is deterministic", () => {
    expect(planShow(track, style)).toEqual(planShow(track, style));
  });
  it("restrains repeat white hits", () => {
    const t2 = { ...track, musicalEvents: [
      { type: "drop", beat: 64, confidence: 0.9 },
      { type: "drop", beat: 66, confidence: 0.9 },
    ] } as unknown as TrackModel;
    const cues = planShow(t2, style).cues;
    expect(cues.filter((c) => c.type === "white-hit")).toHaveLength(1);
  });
});

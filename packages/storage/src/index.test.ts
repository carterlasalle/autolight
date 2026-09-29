import { describe, expect, it } from "vitest";
import { Store } from "./index.js";

describe("storage", () => {
  it("round-trips tracks and plans", () => {
    const s = new Store();
    s.saveTrack("t1", JSON.stringify({ id: "t1" }), 200);
    s.saveShowPlan("t1", "club", "0.1.0", "seed", JSON.stringify({ cues: [] }));
    expect(s.loadShowPlan("t1", "club", "0.1.0")).toBe(JSON.stringify({ cues: [] }));
    s.close();
  });
  it("invalidates artifacts on analyzer bump or fingerprint change", () => {
    const s = new Store();
    s.saveArtifact("t1", "a1", "/cache/t1.json", "fp1");
    expect(s.loadArtifact("t1", "a1", "fp1")).toBe("/cache/t1.json");
    expect(s.loadArtifact("t1", "a2", "fp1")).toBeNull();
    expect(s.loadArtifact("t1", "a1", "fp2")).toBeNull();
    // Planner bump keeps TrackModel artifact, drops only the plan.
    expect(s.loadShowPlan("t1", "club", "0.2.0")).toBeNull();
    s.close();
  });
});

import { describe, expect, it } from "vitest";
import { setupEvidence, setupProgress, type SetupInputs } from "./setup-model.js";

describe("setup evidence steps (T-UI-09)", () => {
  it("marks steps done only with evidence", () => {
    expect(setupProgress({}).next).toBe("dj");
    expect(setupProgress({ dj: true, controller: true }).done).toEqual(["dj", "controller"]);
    const full = Object.fromEntries(
      ["dj", "controller", "library", "lights", "identify", "placement", "orientation", "qualification", "analysis", "preview"].map((s) => [s, true]),
    );
    expect(setupProgress(full as never).next).toBe("ready");
  });
  it("collects identify, chase, and room evidence without inventing readiness", () => {
    const base: SetupInputs = {
      live: null, devices: [], tiles: [], identifiedIds: [], chasePassedIds: [], roomSaved: false,
    };
    expect(setupEvidence(base)).toMatchObject({ dj: false, controller: false, library: false, placement: false });
    const withShow = setupEvidence({
      ...base,
      live: { deckA: { title: "Track" }, deckB: { title: "—" }, cues: [{}, {}], cells: [{}] },
      devices: [{ address: "10.0.0.2" }],
      tiles: [{ id: "10.0.0.2", firmware: "unknown" }],
      identifiedIds: ["10.0.0.2"],
      chasePassedIds: ["10.0.0.2"],
      roomSaved: true,
    });
    expect(withShow).toMatchObject({
      dj: true, library: true, lights: true, identify: true,
      placement: true, orientation: true, qualification: true,
      analysis: true, preview: true, controller: false,
    });
    expect(setupEvidence({ ...base, tiles: [{ id: "t", firmware: "unknown" }] }).identify).toBe(false);
  });
});

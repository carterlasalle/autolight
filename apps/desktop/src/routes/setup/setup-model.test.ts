import { describe, expect, it } from "vitest";
import { SETUP_EVIDENCE_STEPS, SETUP_STEP_INFO, setupEvidence, setupProgress } from "./setup-model.js";

describe("setup evidence steps (T-UI-09)", () => {
  it("marks steps done only with evidence", () => {
    expect(setupProgress({}).next).toBe("dj");
    expect(setupProgress({ dj: true, controller: true }).done).toEqual(["dj", "controller"]);
    const full = Object.fromEntries(
      ["dj", "controller", "library", "lights", "identify", "placement", "orientation", "qualification", "analysis", "preview"].map((s) => [s, true]),
    );
    expect(setupProgress(full as never).next).toBe("ready");
  });

  it("labels every step with a human label and a destination route", () => {
    for (const s of SETUP_EVIDENCE_STEPS) {
      expect(SETUP_STEP_INFO[s].id).toBe(s);
      expect(SETUP_STEP_INFO[s].label.length).toBeGreaterThan(0);
      expect(SETUP_STEP_INFO[s].detail.length).toBeGreaterThan(0);
    }
  });

  it("derives evidence from measured state and leaves unmeasured steps pending", () => {
    const empty = setupProgress(setupEvidence({ showLoaded: false, devicesFound: 0, tilesQualified: 0 }));
    expect(empty.done).toEqual([]);
    expect(empty.next).toBe("dj");
    const loaded = setupProgress(setupEvidence({ showLoaded: true, devicesFound: 2, tilesQualified: 1 }));
    expect(loaded.done).toEqual(["dj", "library", "lights", "identify", "qualification", "analysis", "preview"]);
    expect(loaded.next).toBe("controller");
  });
});

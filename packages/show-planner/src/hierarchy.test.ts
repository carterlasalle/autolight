import { describe, expect, it } from "vitest";
import type { TrackModel } from "@autolight/contracts";
import { compileShow } from "./compile.js";
import { DEFAULT_CONFIG } from "./config.js";
import { BUILT_IN_STYLES } from "./styles.js";
import { DEFAULT_VENUE_CLASS } from "./types.js";
import { validateCompiledPlan } from "./validate.js";
function futureTrack(): TrackModel {
  return {
    schemaVersion: 1,
    analyzerVersion: "t",
    identity: { id: "future", sourceIds: {} },
    durationSeconds: 600,
    beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
    sections: [
      { kind: "verse", startBeat: 192, endBeat: 225, confidence: 0.9 },
      { kind: "build", startBeat: 225, endBeat: 257, confidence: 0.9 },
      { kind: "chorus", startBeat: 257, endBeat: 289, confidence: 0.9 },
    ],
    musicalEvents: [
      { type: "build-start", beat: 225, endBeat: 257, confidence: 0.9 },
      { type: "drop", beat: 257, confidence: 0.95 },
    ],
    analysisCoverage: "full",
  } as TrackModel;
}

function wideTrack(): TrackModel {
  return {
    schemaVersion: 1,
    analyzerVersion: "t",
    identity: { id: "wide", sourceIds: {} },
    durationSeconds: 400,
    beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
    sections: [
      { kind: "verse", startBeat: 0, endBeat: 64, confidence: 0.9 },
      { kind: "build", startBeat: 64, endBeat: 96, confidence: 0.9 },
      { kind: "drop", startBeat: 96, endBeat: 128, confidence: 0.9 },
      { kind: "chorus", startBeat: 128, endBeat: 192, confidence: 0.9 },
    ],
    musicalEvents: [
      { type: "build-start", beat: 64, endBeat: 96, confidence: 0.9 },
      { type: "drop", beat: 96, confidence: 0.95 },
    ],
    analysisCoverage: "full",
  } as TrackModel;
}

describe("T-PLAN-03 hierarchy (P-2.1, P-2.4, P-30)", () => {
  it("stages the build from future knowledge with increasing density and darkness ending at the impact", () => {
    const { plan } = compileShow({
      track: futureTrack(),
      venue: DEFAULT_VENUE_CLASS,
      style: BUILT_IN_STYLES["festival"]!,
      config: DEFAULT_CONFIG,
    });
    const staged = plan.cues.filter((c) => c.startBeat >= 225 && c.startBeat < 257);
    expect(staged.length).toBeGreaterThanOrEqual(4);
    const ramps = staged
      .filter((c) => c.type === "build-ramp")
      .sort((a, b) => a.startBeat - b.startBeat);
    expect(ramps.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < ramps.length; i++) {
      expect(ramps[i]!.intensity).toBeGreaterThanOrEqual(ramps[i - 1]!.intensity - 0.05);
    }
    const dark = plan.cues
      .filter((c) => c.type === "blackout" && c.startBeat + c.durationBeats <= 257 && c.startBeat >= 225)
      .sort((a, b) => b.startBeat - a.startBeat)[0];
    expect(dark).toBeDefined();
    expect(dark!.startBeat + dark!.durationBeats).toBe(257);
    expect(plan.cues.some((c) => c.reason.includes("foreshadowing"))).toBe(true);
  });

  it("covers all six levels on a validation track", () => {
    const { plan } = compileShow({
      track: wideTrack(),
      venue: DEFAULT_VENUE_CLASS,
      style: BUILT_IN_STYLES["festival"]!,
      config: DEFAULT_CONFIG,
    });
    const levels = new Set(plan.cues.map((c) => c.level));
    for (const l of ["section", "phrase", "bar", "beat", "sub-beat"] as const) {
      expect(levels.has(l)).toBe(true);
    }
  });

  it("rejects a cue that changes a forbidden attribute at its level", () => {
    const { plan } = compileShow({
      track: wideTrack(),
      venue: DEFAULT_VENUE_CLASS,
      style: BUILT_IN_STYLES["club"]!,
      config: DEFAULT_CONFIG,
    });
    const bad = {
      ...plan,
      cues: [
        ...plan.cues,
        {
          id: "cue-bad",
          type: "pulse",
          startBeat: 10,
          durationBeats: 0.5,
          intensity: 0.5,
          target: "PRIMARY",
          priority: 60,
          level: "section",
          layer: "base",
          reason: "forbidden level",
        },
      ],
    } as typeof plan;

    const problems = validateCompiledPlan(bad, 400, DEFAULT_CONFIG);
    expect(problems.some((p) => p.includes("level violation"))).toBe(true);
  });
});

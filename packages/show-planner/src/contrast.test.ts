// T-PLAN-06: contrast engine and drop programming (spec 35/36, P-35, P-36).
import { describe, expect, it } from "vitest";
import type { TrackModel } from "@autolight/contracts";
import { compileShow } from "./compile.js";
import { DEFAULT_CONFIG } from "./config.js";
import { fakeDropHold } from "./contrast.js";
import { BUILT_IN_STYLES } from "./styles.js";
import { DEFAULT_VENUE_CLASS } from "./types.js";

function model(): TrackModel {
  return {
    schemaVersion: 2,
    analyzerVersion: "t",
    identity: { id: "contrast", sourceIds: {} },
    durationSeconds: 600,
    beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
    sections: [
      { kind: "breakdown", startBeat: 160, endBeat: 225, confidence: 0.9 },
      { kind: "build", startBeat: 225, endBeat: 257, confidence: 0.9 },
      { kind: "chorus", startBeat: 257, endBeat: 321, confidence: 0.9 },
    ],
    musicalEvents: [
      { type: "build-start", beat: 225, endBeat: 257, confidence: 0.9 },
      { type: "predrop", beat: 256, endBeat: 257, confidence: 0.9 },
      { type: "drop", beat: 257, confidence: 0.95, strength: 0.9 },
      { type: "fake-drop", beat: 300, endBeat: 302, confidence: 0.9 },
      { type: "drop", beat: 302, confidence: 0.9, strength: 0.7 },
    ],
    analysisCoverage: "full",
    readinessLevel: "full",
    analysisCoverage2: {
      level: "full",
      inputs: {
        "source.audio": { status: "absent" },
        "native.rekordbox.grid": { status: "present" },
        "native.rekordbox.pssi": { status: "present" },
        "native.rekordbox.cues": { status: "absent" },
        "native.rekordbox.waveforms": { status: "absent" },
        "native.rekordbox.vocal": { status: "absent" },
        "native.serato.grid": { status: "absent" },
        "native.serato.markers": { status: "absent" },
        "ml.allinone.structure": { status: "absent" },
        "ml.allinone.metrical": { status: "absent" },
        "ml.allinone.activations": { status: "absent" },
        "ml.allinone.embeddings": { status: "absent" },
        "ml.stems": { status: "absent" },
        "ml.beatthis": { status: "absent" },
        "dsp.features": { status: "absent" },
        "dsp.stemProxies": { status: "absent" },
        "events.detectors": { status: "absent" },
        "fusion.structure": { status: "present" },
        "plan.generated": { status: "absent" },
      },
    },
    gridWarnings: [],
    beatFeatures: [],
    phrases: [],
  } as TrackModel;
}

describe("T-PLAN-06 contrast and drops (P-35, P-36)", () => {
  it("holds breakdowns low and builds with a positive slope", () => {
    const { plan } = compileShow({
      track: model(),
      venue: DEFAULT_VENUE_CLASS,
      style: BUILT_IN_STYLES["club"]!,
      config: DEFAULT_CONFIG,
    });
    const mean = (from: number, to: number): number => {
      const inRange = plan.cues.filter((c) => c.startBeat >= from && c.startBeat < to);
      return inRange.reduce((n, c) => n + c.intensity, 0) / Math.max(1, inRange.length);
    };
    expect(mean(160, 225)).toBeLessThanOrEqual(DEFAULT_CONFIG.breakdownMaxMean + 0.15);
    const ramps = plan.cues
      .filter((c) => c.type === "build-ramp" && c.startBeat >= 225 && c.startBeat < 257)
      .sort((a, b) => a.startBeat - b.startBeat);
    expect(ramps.length).toBeGreaterThanOrEqual(3);
    expect(ramps[ramps.length - 1]!.intensity).toBeGreaterThan(ramps[0]!.intensity);
  });

  it("programs the spec 36 structure: staged ramps, desaturation, pre-drop darkness, impact, burst, body", () => {
    const { plan } = compileShow({
      track: model(),
      venue: DEFAULT_VENUE_CLASS,
      style: BUILT_IN_STYLES["club"]!,
      config: DEFAULT_CONFIG,
    });
    // Pre-drop darkness ends exactly at the impact.
    const dark = plan.cues.find(
      (c) => c.type === "blackout" && c.startBeat + c.durationBeats === 257,
    );
    expect(dark).toBeDefined();
    // White impact at the drop, then burst, then saturated body.
    const hit = plan.cues.find((c) => c.type === "white-hit" && c.startBeat === 257);
    expect(hit).toBeDefined();
    expect(hit!.durationBeats).toBeGreaterThan(0);
    expect(hit!.durationBeats).toBeLessThan(1);
    const after = plan.cues.filter((c) => c.startBeat > 257 && c.startBeat < 275);
    expect(after.some((c) => c.type === "drop-pattern")).toBe(true);
    // Second drop varies the target.
    const bodies = plan.cues.filter((c) => c.type === "drop-pattern" && c.startBeat >= 257);
    expect(new Set(bodies.map((c) => c.target)).size).toBeGreaterThan(1);
  });

  it("fires nothing at the fake impact and holds through to the actual beat", () => {
    expect(fakeDropHold(300, 302)).toHaveLength(1);
    const { plan } = compileShow({
      track: model(),
      venue: DEFAULT_VENUE_CLASS,
      style: BUILT_IN_STYLES["club"]!,
      config: DEFAULT_CONFIG,
    });
    // No exclusive impact fires at the fake beat; the hold is darkness.
    const atFake = plan.cues.filter((c) => c.startBeat === 300);
    expect(atFake.some((c) => c.type === "white-hit" || c.type === "impact" || c.type === "drop-pattern")).toBe(false);
    expect(atFake.some((c) => c.type === "blackout" || c.type === "dip")).toBe(true);
    expect(plan.cues.some((c) => (c.type === "white-hit" || c.type === "impact") && c.startBeat === 302)).toBe(true);
  });
});

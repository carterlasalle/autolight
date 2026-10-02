import { describe, expect, it } from "vitest";
import { planShow, blendRgb, sectionEnergy, motifVariant, validatePlan, evaluatePlan, BUILT_IN_STYLES, regenerateSection } from "./index.js";
import type { TrackModel, ShowStyle } from "@autolight/contracts";

const track = {
  schemaVersion: 2, analyzerVersion: "t", identity: { id: "trk1", sourceIds: {} },
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
  it("passes invariants on generated plan", () => {
    expect(validatePlan(planShow(track, style), 200)).toEqual([]);
  });
  it("flags overlapping exclusives and out-of-range cues", () => {
    const bad = planShow(track, style);
    bad.cues.push({ type: "blackout", startBeat: 120, durationBeats: 4, intensity: 0, target: "ALL", priority: 95 });
    bad.cues.push({ type: "impact", startBeat: 9999, durationBeats: 1, intensity: 1, target: "ALL", priority: 90 });
    const problems = validatePlan(bad, 200);
    expect(problems.some((p) => p.includes("overlapping exclusive"))).toBe(true);
    expect(problems.some((p) => p.includes("out-of-range"))).toBe(true);
  });
  it("evaluates plan diagnostics", () => {
    const d = evaluatePlan(planShow(track, style));
    expect(d.whiteHits).toBe(1);
    expect(d.blackoutBeats).toBeGreaterThan(0);
    expect(d.meanIntensity).toBeGreaterThan(0);
  });
  it("scales energy by style range", () => {
    expect(Object.keys(BUILT_IN_STYLES)).toContain("festival");
    const lounge = planShow(track, { ...style, id: "lounge", intensityRange: [0.1, 0.5] });
    const fest = planShow(track, { ...style, id: "festival", intensityRange: [0.4, 1] });
    const peak = (cues: { intensity: number }[]): number => Math.max(...cues.map((c) => c.intensity));
    expect(peak(lounge.cues)).toBeLessThanOrEqual(0.5);
    expect(peak(fest.cues)).toBeGreaterThan(peak(lounge.cues));
  });
  it("regenerates one section, keeps locked cues", () => {
    const plan = planShow(track, style);
    const idx = plan.cues.findIndex((c) => c.startBeat === 64);
    const fresh = [{ type: "section-look", startBeat: 64, durationBeats: 32, intensity: 0.5, target: "PRIMARY", priority: 10 }];
    const regen = regenerateSection(plan, 64, 96, fresh, [idx]);
    expect(regen.cues.filter((c) => c.startBeat === 64)).toHaveLength(2);
    const regen2 = regenerateSection(plan, 64, 96, fresh, []);
    expect(regen2.cues.filter((c) => c.startBeat === 64)).toHaveLength(1);
  });
});

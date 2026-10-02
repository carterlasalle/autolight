// T-PLAN-10: validator and evaluator in production (P-114, P-115).
import { describe, expect, it } from "vitest";
import type { TrackModel } from "@autolight/contracts";
import { compileShow } from "./compile.js";
import { DEFAULT_CONFIG } from "./config.js";
import { BUILT_IN_STYLES } from "./styles.js";
import { DEFAULT_VENUE_CLASS } from "./types.js";
import { diagnosticsOutOfBounds, evaluateCompiledPlan, validateCompiledPlan } from "./validate.js";

function model(): TrackModel {
  return {
    schemaVersion: 2, analyzerVersion: "t", identity: { id: "v10", sourceIds: {} },
    durationSeconds: 400,
    beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
    sections: [
      { kind: "verse", startBeat: 0, endBeat: 32, confidence: 0.9 },
      { kind: "build", startBeat: 32, endBeat: 64, confidence: 0.9 },
      { kind: "chorus", startBeat: 64, endBeat: 96, confidence: 0.9 },
    ],
    musicalEvents: [
      { type: "build-start", beat: 32, endBeat: 64, confidence: 0.9 },
      { type: "drop", beat: 64, confidence: 0.95, strength: 0.9 },
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
const cfg = DEFAULT_CONFIG;
const good = () => compileShow({ track: model(), venue: DEFAULT_VENUE_CLASS, style: BUILT_IN_STYLES["club"]!, config: cfg }).plan;

describe("T-PLAN-10 validator and evaluator (P-114, P-115)", () => {
  it("passes a clean compile with zero problems", () => {
    const plan = good();
    expect(validateCompiledPlan(plan, 200, cfg, { venue: DEFAULT_VENUE_CLASS })).toEqual([]);
  });
  it("rejects overlapping exclusives", () => {
    const plan = good();
    const bad = { ...plan, cues: [...plan.cues,
      { id: "x1", type: "blackout", startBeat: 10, durationBeats: 4, intensity: 0, target: "ALL", priority: 95, level: "beat", layer: "exclusive", reason: "t" },
      { id: "x2", type: "white-hit", startBeat: 12, durationBeats: 1, intensity: 1, target: "ALL", priority: 100, level: "beat", layer: "exclusive", reason: "t" },
    ] } as typeof plan;
    expect(validateCompiledPlan(bad, 200, cfg).some((p) => p.includes("overlapping exclusive"))).toBe(true);
  });
  it("rejects negative durations and out-of-range cues", () => {
    const plan = good();
    const bad = { ...plan, cues: [...plan.cues,
      { id: "x3", type: "pulse", startBeat: 5, durationBeats: -1, intensity: 0.5, target: "PRIMARY", priority: 60, level: "beat", layer: "rhythm", reason: "t" },
      { id: "x4", type: "impact", startBeat: 9999, durationBeats: 1, intensity: 1, target: "ALL", priority: 90, level: "beat", layer: "exclusive", reason: "t" },
    ] } as typeof plan;
    const ps = validateCompiledPlan(bad, 200, cfg);
    expect(ps.some((p) => p.includes("negative duration"))).toBe(true);
    expect(ps.some((p) => p.includes("out-of-range"))).toBe(true);
  });
  it("rejects unknown primitives and level violations", () => {
    const plan = good();
    const bad = { ...plan, cues: [...plan.cues,
      { id: "x5", type: "nope-cue", startBeat: 5, durationBeats: 1, intensity: 0.5, target: "ALL", priority: 10, level: "beat", layer: "accents", reason: "t" },
      { id: "x6", type: "pulse", startBeat: 6, durationBeats: 0.5, intensity: 0.5, target: "PRIMARY", priority: 60, level: "section", layer: "base", reason: "t" },
    ] } as typeof plan;
    const ps = validateCompiledPlan(bad, 200, cfg);
    expect(ps.some((p) => p.includes("unknown primitive"))).toBe(true);
    expect(ps.some((p) => p.includes("level violation"))).toBe(true);
  });
  it("rejects capabilities the venue lacks", () => {
    const plan = good();
    const ps = validateCompiledPlan(plan, 400, cfg, { venue: { ...DEFAULT_VENUE_CLASS, topologies: ["vertical-line"], flags: { ...DEFAULT_VENUE_CLASS.flags, strobe: false } } });
    expect(ps.some((p) => p.includes("unsupported capability"))).toBe(true);
  });
  it("computes all ten spec 115 diagnostics and flags out-of-bounds generations", () => {
    const d = evaluateCompiledPlan(good(), cfg);
    for (const k of ["activeDensity","darknessPct","colourChangeRate","whiteHits","blackouts","strobeBeats","patternRecurrence","spatialEntropy","sectionContrast","intensityArc"] as const) {
      expect(typeof d[k]).toBe("number");
    }
    const tight = { ...cfg, evaluationBounds: { ...cfg.evaluationBounds, whiteHits: [0, 0] as readonly [number, number] } };
    if (d.whiteHits > 0) expect(diagnosticsOutOfBounds(d, tight).some((x) => x.includes("whiteHits"))).toBe(true);
  });
});

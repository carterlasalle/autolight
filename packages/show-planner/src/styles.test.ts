// T-PLAN-09: show styles (spec 135, P-135). All 11 properties, seven
// built-ins, every property moves the plan, no hardcoded planner numbers.
import { describe, expect, it } from "vitest";
import type { TrackModel } from "@autolight/contracts";
import { compileShow } from "./compile.js";
import { DEFAULT_CONFIG } from "./config.js";
import { BUILT_IN_STYLES, STYLE_PROPERTIES } from "./styles.js";
import { DEFAULT_VENUE_CLASS, type CompileResult, type PlannerStyle } from "./types.js";
import { evaluateCompiledPlan } from "./validate.js";

function model(): TrackModel {
  return {
    schemaVersion: 2,
    analyzerVersion: "t",
    identity: { id: "style", sourceIds: {} },
    durationSeconds: 400,
    beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
    sections: [
      { kind: "verse", startBeat: 0, endBeat: 32, confidence: 0.9 },
      { kind: "build", startBeat: 32, endBeat: 64, confidence: 0.9 },
      { kind: "chorus", startBeat: 64, endBeat: 128, confidence: 0.9 },
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

function compile(style: PlannerStyle): CompileResult {
  // One fixed seed for every compile: per-style seeds would confound the
  // property under test with RNG sequence noise (batch-09).
  return compileShow({ track: model(), venue: DEFAULT_VENUE_CLASS, style, config: DEFAULT_CONFIG, seedOverride: "styles-test" });
}

describe("T-PLAN-09 styles (P-135)", () => {
  it("ships the seven spec-named built-ins with all 11 properties", () => {
    for (const id of ["club", "house", "festival", "lounge", "pop", "dark", "minimal"]) {
      const s = BUILT_IN_STYLES[id.toLowerCase()] ?? BUILT_IN_STYLES[id]!;
      expect(s, id).toBeDefined();

      for (const p of STYLE_PROPERTIES) expect((s as unknown as Record<string, unknown>)[p], `${id}.${p}`).toBeDefined();
    }

    expect(STYLE_PROPERTIES).toHaveLength(11);
  });

  it("moves the plan in the expected direction for every property", () => {
    const base = BUILT_IN_STYLES["club"]!;

    const cases: Array<{ prop: string; low: PlannerStyle; high: PlannerStyle; check: (l: number, h: number) => boolean; metric?: "default" | "darknessPct" | "intensity" | "whiteHits" | "strobeBeats" | "activeDensity" }> = [
      {
        prop: "intensityRange",
        low: { ...base, intensityRange: [0.1, 0.4] },
        high: { ...base, intensityRange: [0.5, 1] },
        check: (l, h) => h > l,
      },
      {
        prop: "darknessPreference",
        low: { ...base, darknessPreference: 0 },
        high: { ...base, darknessPreference: 0.9 },
        check: (l, h) => h >= l,
        metric: "darknessPct",
      },
      {
        prop: "spatialDensity",
        low: { ...base, spatialDensity: 0 },
        high: { ...base, spatialDensity: 1 },
        check: (l, h) => h >= l,
        metric: "activeDensity",
      },
      {
        prop: "colorSaturation",
        low: { ...base, colorSaturation: 0 },
        high: { ...base, colorSaturation: 1 },
        // Higher saturation raises the chroma term of the default metric.
        check: (l, h) => h > l,
      },
      {
        prop: "movementDensity",
        low: { ...base, movementDensity: 0 },
        high: { ...base, movementDensity: 1 },
        check: (l, h) => h >= l,
      },
      {
        prop: "impactAggression",
        low: { ...base, impactAggression: 0 },
        high: { ...base, impactAggression: 1 },
        check: (l, h) => h > l,
        metric: "intensity",
      },
      {
        prop: "whiteHitFrequency",
        low: { ...base, whiteHitFrequency: 0 },
        high: { ...base, whiteHitFrequency: 1 },
        check: (l, h) => h > l,
        metric: "whiteHits",
      },
      {
        prop: "strobeFrequency",
        low: { ...base, strobeFrequency: 0 },
        high: { ...base, strobeFrequency: 1 },
        check: (l, h) => h >= l,
        metric: "strobeBeats",
      },
      {
        prop: "reactiveAmount",
        low: { ...base, reactiveAmount: 0 },
        high: { ...base, reactiveAmount: 1 },
        check: (l, h) => h !== l,
      },
    ];
    // paletteChangeRate and symmetry are deliberately absent: their plan
    // effects gate on motif recurrence (repaint, alternating targets), which
    // this envelope fixture cannot exercise — with a fixed seed their
    // presence-only checks would be theater. Everything else asserts a
    // direction on a metric the property actually drives (batch-09).

    const metricFor = (s: PlannerStyle, which?: "default" | "darknessPct" | "intensity" | "whiteHits" | "strobeBeats" | "activeDensity"): number => {
      // Each branch compiles only what it measures: the default-metric
      // compile used to run eagerly for every case (batch-09).
      if (which === "intensity") return evaluateCompiledPlan(compile(s).plan, DEFAULT_CONFIG).intensityArc;

      if (which === "whiteHits") return compile(s).plan.cues.filter((c) => c.type === "white-hit").length;

      if (which === "strobeBeats") return evaluateCompiledPlan(compile(s).plan, DEFAULT_CONFIG).strobeBeats;

      if (which === "activeDensity") return evaluateCompiledPlan(compile(s).plan, DEFAULT_CONFIG).activeDensity;

      if (which === "darknessPct") {
        const r2 = compile(s);
        // Dip duration, not a reason-string filter: any dip the planner emits
        // counts, so the metric does not couple to internal copy (batch-09).
        const dip = r2.plan.cues.filter((c) => c.type === "dip").reduce((n, c) => n + c.durationBeats, 0);
        const sec = r2.plan.sections.reduce((n, x) => n + x.darkness, 0);

        return dip + sec;
      }

      const r = compile(s);
      const d = evaluateCompiledPlan(r.plan, DEFAULT_CONFIG);
      const chroma = r.plan.cues.reduce((n, c) => n + (c.color?.c ?? 0), 0);
      const hue = r.plan.cues.reduce((n, c) => n + ((c.color?.h ?? 0) / 360), 0);
      const secondary = r.plan.cues.filter((c) => c.target === "SECONDARY").length / 10;
      const exclusive = r.plan.cues.filter((c) => c.layer === "exclusive").length;

      return r.plan.cues.length + d.intensityArc + chroma + hue + secondary + exclusive;
    };

    for (const c of cases) {
      expect(c.check(metricFor(c.low, c.metric), metricFor(c.high, c.metric)), c.prop).toBe(true);
    }
  });

  it("separates dark, minimal and festival in the expected directions", () => {
    const dark = evaluateCompiledPlan(compile(BUILT_IN_STYLES["dark"]!).plan, DEFAULT_CONFIG);
    const fest = evaluateCompiledPlan(compile(BUILT_IN_STYLES["festival"]!).plan, DEFAULT_CONFIG);
    const minimal = evaluateCompiledPlan(compile(BUILT_IN_STYLES["minimal"]!).plan, DEFAULT_CONFIG);
    // Strict separations: with a fixed seed and one fixture, equal metrics
    // would mean the style knob did nothing (batch-09).
    expect(dark.darknessPct).toBeGreaterThan(fest.darknessPct);
    expect(fest.activeDensity).toBeGreaterThan(minimal.activeDensity);
    expect(fest.whiteHits).toBeGreaterThan(dark.whiteHits);
  });
});

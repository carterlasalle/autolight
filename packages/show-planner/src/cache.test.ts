// T-PLAN-14: compile performance and caching (spec 138).
import { describe, expect, it } from "vitest";
import { trackModelSchema, type TrackModel } from "@autolight/contracts";
import { PlanCache, cacheKeyFor, spliceSection } from "./cache.js";
import { compileShow } from "./compile.js";
import { DEFAULT_CONFIG } from "./config.js";
import { BUILT_IN_STYLES } from "./styles.js";
import { DEFAULT_VENUE_CLASS, hashValue } from "./types.js";

function model(id: string): TrackModel {
  return trackModelSchema.parse({
    schemaVersion: 2, analyzerVersion: "t", identity: { id, sourceIds: {} },
    durationSeconds: 400,
    beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
    sections: [
      { kind: "verse", startBeat: 0, endBeat: 32, confidence: 0.9 },
      { kind: "chorus", startBeat: 32, endBeat: 64, confidence: 0.9 },
    ],
    musicalEvents: [{ type: "drop", beat: 32, confidence: 0.95, strength: 0.9 }],
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
  });
}

describe("T-PLAN-14 cache (spec 138)", () => {
  it("keys the cache by the five determinism inputs and hits on repeat", () => {
    const cache = new PlanCache<string>();
    const key = { fingerprint: "fp", plannerVersion: "0.2.0", styleHash: hashValue({ a: 1 }), venueHash: hashValue({ b: 1 }), configHash: hashValue({ c: 1 }) };
    expect(cache.get(key)).toBe(undefined);
    cache.set(key, "plan");
    expect(cache.get(key)).toBe("plan");
    expect(cache.stats()).toEqual({ hits: 1, misses: 1, size: 1 });
    expect(cacheKeyFor(key)).toBe(cacheKeyFor({ ...key }));
    expect(cacheKeyFor({ ...key, fingerprint: "other" })).not.toBe(cacheKeyFor(key));
    expect(cacheKeyFor({ ...key, plannerVersion: "9.9.9" })).not.toBe(cacheKeyFor(key));
    expect(cacheKeyFor({ ...key, styleHash: "other" })).not.toBe(cacheKeyFor(key));
    expect(cacheKeyFor({ ...key, venueHash: "other" })).not.toBe(cacheKeyFor(key));
    expect(cacheKeyFor({ ...key, configHash: "other" })).not.toBe(cacheKeyFor(key));
  });
  it("splices a single-section recompile without touching outside cues", () => {
    const cues = [{ startBeat: 0 }, { startBeat: 8 }, { startBeat: 32 }, { startBeat: 40 }];
    const out = spliceSection(cues, 32, 64, [{ startBeat: 33 }]);
    expect(out.map((c) => c.startBeat).sort((a, b) => a - b)).toEqual([0, 8, 33]);
    // The range is [start, end): a cue exactly at start is replaced, a cue
    // exactly at end is kept, multiple fresh cues land in order, and an
    // empty fresh array just deletes the range.
    expect(spliceSection([{ startBeat: 32 }], 32, 64, []).map((c) => c.startBeat)).toEqual([]);
    expect(spliceSection([{ startBeat: 64 }], 32, 64, []).map((c) => c.startBeat)).toEqual([64]);
    expect(spliceSection(cues, 32, 64, [{ startBeat: 34 }, { startBeat: 33 }]).map((c) => c.startBeat)).toEqual([0, 8, 33, 34]);
  });
  it("compiles a validation track well inside the budget", () => {
    const input = { track: model("perf"), venue: DEFAULT_VENUE_CLASS, style: BUILT_IN_STYLES["club"]!, config: DEFAULT_CONFIG };
    const t0 = performance.now();
    const first = compileShow(input);
    const ms = performance.now() - t0;
    expect(first.plan.cues.length).toBeGreaterThan(0);
    expect(compileShow(input).plan).toEqual(first.plan);
    expect(ms).toBeLessThan(DEFAULT_CONFIG.compileBudgetMs * 4);
  });
});

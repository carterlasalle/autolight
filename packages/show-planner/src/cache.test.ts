// T-PLAN-14: compile performance and caching (spec 138).
import { describe, expect, it } from "vitest";
import type { TrackModel } from "@autolight/contracts";
import { PlanCache, cacheKeyFor, spliceSection } from "./cache.js";
import { compileShow } from "./compile.js";
import { DEFAULT_CONFIG } from "./config.js";
import { BUILT_IN_STYLES } from "./styles.js";
import { DEFAULT_VENUE_CLASS, hashValue } from "./types.js";

function model(id: string): TrackModel {
  return {
    schemaVersion: 1, analyzerVersion: "t", identity: { id, sourceIds: {} },
    durationSeconds: 400,
    beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
    sections: [
      { kind: "verse", startBeat: 0, endBeat: 32, confidence: 0.9 },
      { kind: "chorus", startBeat: 32, endBeat: 64, confidence: 0.9 },
    ],
    musicalEvents: [{ type: "drop", beat: 32, confidence: 0.95, strength: 0.9 }],
    analysisCoverage: "full",
  } as TrackModel;
}

describe("T-PLAN-14 cache (spec 138)", () => {
  it("keys the cache by the five determinism inputs and hits on repeat", () => {
    const cache = new PlanCache<string>();
    const key = { fingerprint: "fp", plannerVersion: "0.2.0", styleHash: hashValue({ a: 1 }), venueHash: hashValue({ b: 1 }), configHash: hashValue({ c: 1 }) };
    expect(cache.get(key)).toBe(undefined);
    cache.set(key, "plan");
    expect(cache.get(key)).toBe("plan");
    expect(cache.stats()).toEqual({ hits: 1, misses: 1, size: 1 });
    expect(cacheKeyFor({ ...key, styleHash: "other" })).not.toBe(cacheKeyFor(key));
  });
  it("splices a single-section recompile without touching outside cues", () => {
    const cues = [{ startBeat: 0 }, { startBeat: 8 }, { startBeat: 32 }, { startBeat: 40 }];
    const out = spliceSection(cues, 32, 64, [{ startBeat: 33 }]);
    expect(out.map((c) => c.startBeat).sort((a, b) => a - b)).toEqual([0, 8, 33]);
  });
  it("compiles a validation track well inside the budget", () => {
    const t0 = performance.now();
    compileShow({ track: model("perf"), venue: DEFAULT_VENUE_CLASS, style: BUILT_IN_STYLES["club"]!, config: DEFAULT_CONFIG });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(DEFAULT_CONFIG.compileBudgetMs);
  });
});

import { describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { trackModelSchema, showPlanSchema } from "@autolight/contracts";
import { configSnapshotHash, styleHash, venueClassHash } from "./cache.js";
import { clearFastPathCache, fastPathBudget, fastPathCacheSize, fastPathTimings, type FastPathRequest, loadFastPath, resetFastPath } from "./fastpath.js";
import { Store } from "./index.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "test-fixtures", "analysis");
const trackFixture = join(fixtureDir, "live-deck1.trackmodel.json");
const planFixture = join(fixtureDir, "live-deck1.showplan.json");

const trackModel = trackModelSchema.parse(JSON.parse(readFileSync(trackFixture, "utf8")));
const showPlan = showPlanSchema.parse(JSON.parse(readFileSync(planFixture, "utf8")));
const style = { id: showPlan.styleId };
const configHash = configSnapshotHash({ "runtime.clock.tickHz": 60, "runtime.fastPath.budgetMs": 100 });

function request(overrides: Partial<FastPathRequest> = {}): FastPathRequest {
  return {
    trackId: trackModel.identity.id,
    styleId: showPlan.styleId,
    analyzerVersion: trackModel.analyzerVersion,
    plannerVersion: showPlan.plannerVersion,
    styleHash: styleHash(style),
    venueClass: venueClassHash(["segments"]),
    configHash,
    sourceFingerprint: "fp-1",
    ...overrides,
  };
}

function storeWith(artifactPath: string, planJson: string | null): Store {
  const store = new Store();
  const key = request();
  store.saveTrack(key.trackId, JSON.stringify(trackModel.identity), trackModel.durationSeconds);
  store.saveArtifact(key.trackId, key.analyzerVersion, artifactPath, key.sourceFingerprint, { configHash: key.configHash });
  if (planJson !== null) {
    store.saveShowPlan(key.trackId, key.styleId, key.plannerVersion, showPlan.seed, planJson, {
      sourceFingerprint: key.sourceFingerprint,
      styleHash: key.styleHash,
      venueClass: key.venueClass,
      configHash: key.configHash,
    });
  }
  return store;
}

describe("fast path loader (T-DATA-04, spec 138)", () => {
  it("returns parsed and validated TrackModel and ShowPlan objects (P-138)", () => {
    resetFastPath();
    const store = storeWith(trackFixture, JSON.stringify(showPlan));
    try {
      const result = loadFastPath(store, request());
      expect(result.miss).toBeNull();
      expect(result.track?.identity.id).toBe("live-deck1");
      expect(result.track?.beatGrid.beats.length).toBeGreaterThan(100);
      expect(result.plan?.cues.length).toBe(showPlan.cues.length);
      expect(result.timings.cacheHit).toBe(false);
      expect(result.timings.totalMs).toBeGreaterThanOrEqual(0);
    } finally {
      store.close();
    }
  });

  it("never returns an artifact path as the track model (F-DATA-04 regression)", () => {
    resetFastPath();
    const store = storeWith("/cache/real.json", JSON.stringify(showPlan));
    try {
      const result = loadFastPath(store, request());
      expect(typeof result.track).not.toBe("string");
      expect(result.track).toBeNull();
      expect(result.plan).toBeNull();
      expect(result.miss).toBe("invalid-artifact");
      expect(result.detail).toContain("/cache/real.json");
    } finally {
      store.close();
    }
  });

  it("rejects an artifact that parses as JSON but is not a TrackModel", () => {
    resetFastPath();
    const dir = mkdtempSync(join(tmpdir(), "autolight-fastpath-"));
    const bogus = join(dir, "bogus.json");
    try {
      writeFileSync(bogus, JSON.stringify({ schemaVersion: 1 }));
      const store = storeWith(bogus, JSON.stringify(showPlan));
      try {
        const result = loadFastPath(store, request());
        expect(result.miss).toBe("invalid-artifact");
        expect(result.track).toBeNull();
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves a repeat from the in-memory LRU without touching the artifact file", () => {
    resetFastPath();
    const dir = mkdtempSync(join(tmpdir(), "autolight-lru-"));
    const copy = join(dir, "trackmodel.json");
    try {
      copyFileSync(trackFixture, copy);
      const store = storeWith(copy, JSON.stringify(showPlan));
      try {
        const cold = loadFastPath(store, request());
        expect(cold.track).not.toBeNull();
        expect(fastPathCacheSize()).toBe(1);
        rmSync(copy);
        const warm = loadFastPath(store, request());
        expect(warm.timings.cacheHit).toBe(true);
        expect(warm.track?.identity.id).toBe("live-deck1");
        expect(warm.plan?.cues.length).toBe(showPlan.cues.length);
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers with typed misses", () => {
    resetFastPath();
    const store = storeWith(trackFixture, JSON.stringify(showPlan));
    try {
      expect(loadFastPath(store, request({ analyzerVersion: "9.9.9" })).miss).toBe("no-artifact");
      expect(loadFastPath(store, request({ sourceFingerprint: "fp-other" })).miss).toBe("no-artifact");

      const withoutPlan = storeWith(trackFixture, null);
      try {
        const result = loadFastPath(withoutPlan, request());
        expect(result.miss).toBe("no-plan");
        expect(result.track).not.toBeNull();
        expect(result.plan).toBeNull();
        expect(result.detail).toContain("compile from cached features");
      } finally {
        withoutPlan.close();
      }

      const otherStyle = storeWith(trackFixture, JSON.stringify(showPlan));
      try {
        const styled = loadFastPath(otherStyle, request({ styleHash: styleHash({ id: "house" }) }));
        expect(styled.miss).toBe("no-plan");
        expect(styled.track).not.toBeNull();
      } finally {
        otherStyle.close();
      }
    } finally {
      store.close();
    }
  });

  it("reports an unparseable plan row as an invalid plan, not as a missing one", () => {
    resetFastPath();
    const store = storeWith(trackFixture, "{not json");
    try {
      const result = loadFastPath(store, request());
      expect(result.miss).toBe("invalid-plan");
      expect(result.track).not.toBeNull();
      expect(result.plan).toBeNull();
      expect(result.detail).toContain("did not parse to a ShowPlan");
    } finally {
      store.close();
    }
  });

  it("rejects a plan whose content belongs to another track", () => {
    resetFastPath();
    const mismatched = JSON.stringify({ ...showPlan, trackId: "someone-else" });
    const store = storeWith(trackFixture, mismatched);
    try {
      const result = loadFastPath(store, request());
      expect(result.miss).toBe("invalid-plan");
      expect(result.detail).toContain("plan key mismatch");
    } finally {
      store.close();
    }
  });

  it("keeps cold-load p95 inside runtime.fastPath.budgetMs (P-138)", () => {
    resetFastPath();
    const store = storeWith(trackFixture, JSON.stringify(showPlan));
    const budgetMs = 100;
    try {
      for (let i = 0; i < 150; i += 1) {
        clearFastPathCache();
        const result = loadFastPath(store, request());
        expect(result.track).not.toBeNull();
      }
      const stats = fastPathTimings();
      expect(stats.count).toBe(150);
      expect(stats.p95).toBeLessThan(budgetMs);
      expect(fastPathBudget(budgetMs).pass).toBe(true);
      console.info(
        `P-138: ${stats.count} cold loads, p50 ${stats.p50.toFixed(2)} ms, p95 ${stats.p95.toFixed(2)} ms, ` +
          `p99 ${stats.p99.toFixed(2)} ms, max ${stats.max.toFixed(2)} ms, budget ${budgetMs} ms`,
      );
    } finally {
      store.close();
    }
  });
});

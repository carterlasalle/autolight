import { describe, expect, it } from "vitest";
import {
  artifactFresh,
  artifactKey,
  configSnapshotHash,
  invalidate,
  planFresh,
  planKey,
  sourceFingerprint,
  stableHash,
  styleHash,
  venueClassHash,
  type ArtifactRow,
  type PlanRow,
} from "./cache.js";
import { Store } from "./index.js";

function seed(): Store {
  const store = new Store();
  store.saveTrack("t1", JSON.stringify({ id: "t1", sourceIds: {} }), 200);
  store.saveArtifact("t1", "a1", "/cache/t1-a1.json", "fp1", { configHash: "cfg1" });
  store.saveArtifact("t1", "a2", "/cache/t1-a2.json", "fp1", { configHash: "cfg1" });
  store.run(
    "INSERT INTO analysis_runs (track_id, analyzer_version, schema_version, config_hash, fingerprint, state) VALUES (?, ?, ?, ?, ?, ?)",
    ["t1", "a1", "1", "cfg1", "fp1", "ready"],
  );
  store.run(
    "INSERT INTO analysis_runs (track_id, analyzer_version, schema_version, config_hash, fingerprint, state) VALUES (?, ?, ?, ?, ?, ?)",
    ["t1", "a2", "1", "cfg1", "fp1", "ready"],
  );
  store.run(
    "INSERT INTO native_analysis (track_id, source, grid_json) VALUES (?, ?, ?)",
    ["t1", "rekordbox", "{}"],
  );
  store.saveShowPlan("t1", "club", "p1", "seed", '{"trackId":"t1","cues":[]}', {
    sourceFingerprint: "fp1",
    styleHash: styleHash({ id: "club" }),
    venueClass: venueClassHash(["segments"]),
    configHash: "cfg1",
  });
  store.saveShowPlan("t1", "house", "p1", "seed", '{"trackId":"t1","cues":[]}', {
    sourceFingerprint: "fp1",
    styleHash: styleHash({ id: "house" }),
    venueClass: venueClassHash(["segments"]),
    configHash: "cfg1",
  });
  return store;
}

function counts(store: Store): Record<string, number> {
  const one = (sql: string): number => Number(store.get<{ n: number }>(sql)?.n ?? 0);
  return {
    tracks: one("SELECT COUNT(*) AS n FROM tracks"),
    artifacts: one("SELECT COUNT(*) AS n FROM analysis_artifacts"),
    runs: one("SELECT COUNT(*) AS n FROM analysis_runs"),
    plans: one("SELECT COUNT(*) AS n FROM show_plans"),
    native: one("SELECT COUNT(*) AS n FROM native_analysis"),
  };
}

describe("cache versioning and selective invalidation (T-DATA-03, spec 82)", () => {
  it("invalidates analysis-dependent artifacts only when the analyzer version changes (P-82)", () => {
    const store = seed();
    try {
      const report = invalidate(store, { rule: "analyzer", analyzerVersion: "a2" });
      expect(report.deleted).toEqual({ analysis_artifacts: 1, analysis_runs: 1 });
      const after = counts(store);
      expect(after).toMatchObject({ tracks: 1, artifacts: 1, runs: 1, plans: 2, native: 1 });
      expect(store.loadArtifact("t1", "a1", "fp1")).toBeNull();
      expect(store.loadArtifact("t1", "a2", "fp1")).toBe("/cache/t1-a2.json");
      expect(store.loadShowPlan("t1", "club", "p1")).not.toBeNull();
    } finally {
      store.close();
    }
  });

  it("reuses TrackModels and regenerates plans when the planner version changes (P-82)", () => {
    const store = seed();
    try {
      const report = invalidate(store, { rule: "planner", plannerVersion: "p2" });
      expect(report.deleted).toEqual({ show_plans: 2 });
      const after = counts(store);
      expect(after).toMatchObject({ tracks: 1, artifacts: 2, runs: 2, plans: 0 });
      expect(store.loadArtifact("t1", "a2", "fp1")).toBe("/cache/t1-a2.json");
    } finally {
      store.close();
    }
  });

  it("reuses TrackModels and semantic plans when the venue changes (P-82)", () => {
    const store = seed();
    try {
      const report = invalidate(store, { rule: "venue", venueClass: venueClassHash(["segments", "zones"]) });
      expect(report.deleted).toEqual({});
      expect(counts(store)).toMatchObject({ artifacts: 2, plans: 2 });
      expect(store.loadShowPlan("t1", "club", "p1")).not.toBeNull();
    } finally {
      store.close();
    }
  });

  it("regenerates plans for the changed style only (P-82)", () => {
    const store = seed();
    try {
      const report = invalidate(store, { rule: "style", styleId: "house" });
      expect(report.deleted).toEqual({ show_plans: 1 });
      expect(store.loadShowPlan("t1", "house", "p1")).toBeNull();
      expect(store.loadShowPlan("t1", "club", "p1")).not.toBeNull();
      expect(counts(store)).toMatchObject({ artifacts: 2, tracks: 1 });
    } finally {
      store.close();
    }
  });

  it("invalidates only the changed track's derived rows on a library change (T-RBL-06)", () => {
    const store = seed();
    try {
      store.saveTrack("t2", JSON.stringify({ id: "t2", sourceIds: {} }), 180);
      store.saveArtifact("t2", "a2", "/cache/t2.json", "fp2", { configHash: "cfg1" });
      const report = invalidate(store, { rule: "library", trackId: "t1", sourceFingerprint: "fp2" });
      expect(report.deleted).toEqual({ analysis_artifacts: 2, show_plans: 2, native_analysis: 1 });
      const after = counts(store);
      expect(after).toMatchObject({ tracks: 2, artifacts: 1, plans: 0, native: 0 });
      expect(store.loadArtifact("t2", "a2", "fp2")).toBe("/cache/t2.json");
    } finally {
      store.close();
    }
  });

  it("invalidates plans built under another config snapshot (P-82)", () => {
    const store = seed();
    try {
      const report = invalidate(store, { rule: "config", configHash: "cfg2" });
      expect(report.deleted).toEqual({ show_plans: 2 });
      expect(counts(store)).toMatchObject({ artifacts: 2, runs: 2 });
      expect(store.loadShowPlan("t1", "club", "p1")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("keys are stable, ordered-independent and sensitive to every part", () => {
    const snapshotA = { "runtime.clock.tickHz": 60, "render.gammaDefault": 2.2 };
    const snapshotB = { "render.gammaDefault": 2.2, "runtime.clock.tickHz": 60 };
    expect(configSnapshotHash(snapshotA)).toBe(configSnapshotHash(snapshotB));
    expect(configSnapshotHash({ ...snapshotA, "runtime.clock.tickHz": 120 })).not.toBe(configSnapshotHash(snapshotA));

    expect(venueClassHash(["zones", "segments"])).toBe(venueClassHash(["segments", "zones"]));
    expect(venueClassHash(["zones"])).not.toBe(venueClassHash(["segments"]));
    expect(styleHash({ id: "club" })).toBe(styleHash({ id: "club" }));
    expect(styleHash({ id: "club", strobeFrequency: 0.4 })).not.toBe(styleHash({ id: "club" }));

    const parts = { trackId: "t1", analyzerVersion: "a1", sourceFingerprint: "fp1", configHash: "cfg1" };
    expect(artifactKey(parts)).toBe(artifactKey({ ...parts }));
    expect(artifactKey(parts)).not.toBe(artifactKey({ ...parts, analyzerVersion: "a2" }));
    const planParts = {
      trackId: "t1",
      styleId: "club",
      plannerVersion: "p1",
      sourceFingerprint: "fp1",
      styleHash: "sh1",
      venueClass: "vc1",
      configHash: "cfg1",
    };
    expect(planKey(planParts)).not.toBe(planKey({ ...planParts, venueClass: "vc2" }));
    expect(planKey(planParts)).not.toBe(planKey({ ...planParts, configHash: "cfg2" }));
    expect(planKey(planParts)).not.toBe(planKey({ ...planParts, styleHash: "sh2" }));
    expect(stableHash("x")).toHaveLength(16);
  });

  it("fingerprints source files by path, size, mtime and optional content hash", () => {
    const base = { path: "/music/a.mp3", sizeBytes: 1000, mtimeMs: 1234.56 };
    expect(sourceFingerprint(base)).toBe(sourceFingerprint({ ...base, mtimeMs: 1234.9 }));
    expect(sourceFingerprint(base)).not.toBe(sourceFingerprint({ ...base, sizeBytes: 1001 }));
    expect(sourceFingerprint(base)).not.toBe(sourceFingerprint({ ...base, path: "/music/b.mp3" }));
    expect(sourceFingerprint(base)).not.toBe(sourceFingerprint({ ...base, contentHash: "abc" }));
  });

  it("tells a fresh row from a stale one", () => {
    const artifact: ArtifactRow = {
      track_id: "t1",
      schema_version: "1",
      analyzer_version: "a1",
      config_hash: "cfg1",
      fingerprint: "fp1",
      artifact_path: "/cache/t1.json",
      created_at: null,
    };
    expect(artifactFresh(artifact, { trackId: "t1", analyzerVersion: "a1", sourceFingerprint: "fp1", configHash: "cfg1" })).toBe(true);
    expect(artifactFresh(artifact, { trackId: "t1", analyzerVersion: "a2", sourceFingerprint: "fp1", configHash: "cfg1" })).toBe(false);
    expect(artifactFresh(artifact, { trackId: "t1", analyzerVersion: "a1", sourceFingerprint: "fp2", configHash: "cfg1" })).toBe(false);

    const plan: PlanRow = {
      track_id: "t1",
      style_id: "club",
      planner_version: "p1",
      schema_version: "1",
      source_fingerprint: "fp1",
      style_hash: "sh1",
      venue_class: "vc1",
      config_hash: "cfg1",
      seed: "seed",
      plan_json: "{}",
      created_at: null,
    };
    const key = {
      trackId: "t1",
      styleId: "club",
      plannerVersion: "p1",
      sourceFingerprint: "fp1",
      styleHash: "sh1",
      venueClass: "vc1",
      configHash: "cfg1",
    };
    expect(planFresh(plan, key)).toBe(true);
    expect(planFresh(plan, { ...key, venueClass: "vc2" })).toBe(false);
    expect(planFresh(plan, { ...key, plannerVersion: "p2" })).toBe(false);
  });
});

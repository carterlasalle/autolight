import { createHash } from "node:crypto";
import type { SqlExec } from "./driver.js";

// Cache versioning and selective invalidation (T-DATA-03, spec 82). Every
// artifact row carries schema version, analyzer version, planner version,
// source fingerprint and config hash; every plan row carries the plan cache
// key (track fingerprint, planner version, style hash, venue capability class
// hash, config snapshot hash). Invalidation is per rule and per row, never a
// wipe-all.

export const CACHE_SCHEMA_VERSION = "1";

export interface ArtifactKeyParts {
  trackId: string;
  analyzerVersion: string;
  sourceFingerprint: string;
  configHash: string;
  schemaVersion?: string;
}

export interface PlanKeyParts {
  trackId: string;
  styleId: string;
  plannerVersion: string;
  sourceFingerprint: string;
  styleHash: string;
  venueClass: string;
  configHash: string;
  schemaVersion?: string;
}

export interface ArtifactRow {
  track_id: string;
  schema_version: string;
  analyzer_version: string;
  config_hash: string;
  fingerprint: string;
  artifact_path: string;
  created_at: string | null;
}

export interface PlanRow {
  track_id: string;
  style_id: string;
  planner_version: string;
  schema_version: string;
  source_fingerprint: string;
  style_hash: string;
  venue_class: string;
  config_hash: string;
  seed: string;
  plan_json: string;
  created_at: string | null;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function stableHash(value: unknown, length = 16): string {
  return createHash("sha256").update(canonical(value)).digest("hex").slice(0, length);
}

// Config snapshot hash: the resolved values of every config key the artifact
// depends on. A different snapshot is a different cache entry, never a
// silently reused one.
export function configSnapshotHash(values: Record<string, unknown>): string {
  return stableHash(values);
}

export function styleHash(style: unknown): string {
  return stableHash(style);
}

// Venue capability class: the sorted capability set of the venue's fixtures.
export function venueClassHash(capabilities: readonly string[]): string {
  return stableHash([...capabilities].sort());
}

export interface SourceFingerprintParts {
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  contentHash?: string;
}

export function sourceFingerprint(parts: SourceFingerprintParts): string {
  return stableHash([parts.path, parts.sizeBytes, Math.round(parts.mtimeMs), parts.contentHash ?? null]);
}

export function artifactKey(parts: ArtifactKeyParts): string {
  return [parts.schemaVersion ?? CACHE_SCHEMA_VERSION, parts.analyzerVersion, parts.configHash, parts.sourceFingerprint].join("|");
}

export function planKey(parts: PlanKeyParts): string {
  return [
    parts.schemaVersion ?? CACHE_SCHEMA_VERSION,
    parts.plannerVersion,
    parts.styleHash,
    parts.venueClass,
    parts.configHash,
    parts.sourceFingerprint,
  ].join("|");
}

export function artifactFresh(row: ArtifactRow, parts: ArtifactKeyParts): boolean {
  return (
    row.schema_version === (parts.schemaVersion ?? CACHE_SCHEMA_VERSION) &&
    row.analyzer_version === parts.analyzerVersion &&
    row.config_hash === parts.configHash &&
    row.fingerprint === parts.sourceFingerprint
  );
}

export function planFresh(row: PlanRow, parts: PlanKeyParts): boolean {
  return (
    row.schema_version === (parts.schemaVersion ?? CACHE_SCHEMA_VERSION) &&
    row.planner_version === parts.plannerVersion &&
    row.style_hash === parts.styleHash &&
    row.venue_class === parts.venueClass &&
    row.config_hash === parts.configHash &&
    row.source_fingerprint === parts.sourceFingerprint
  );
}

export type Invalidation =
  | { rule: "analyzer"; analyzerVersion: string }
  | { rule: "planner"; plannerVersion: string }
  | { rule: "venue"; venueClass: string }
  | { rule: "style"; styleId: string }
  | { rule: "library"; trackId: string; sourceFingerprint: string }
  | { rule: "config"; configHash: string };

export interface InvalidationReport {
  rule: Invalidation["rule"];
  deleted: Record<string, number>;
  reused: string[];
  note: string;
}

function deleteWhere(db: SqlExec, table: string, where: string, params: readonly (string | number)[]): number {
  const row = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, params);
  const count = Number(row?.n ?? 0);
  if (count > 0) db.run(`DELETE FROM ${table} WHERE ${where}`, params);
  return count;
}

export function invalidate(db: SqlExec, invalidation: Invalidation): InvalidationReport {
  switch (invalidation.rule) {
    case "analyzer": {
      // Analyzer change invalidates analysis-dependent artifacts only; plans
      // and the library-derived native analysis survive (spec 82).
      const artifacts = deleteWhere(db, "analysis_artifacts", "analyzer_version <> ?", [invalidation.analyzerVersion]);
      const runs = deleteWhere(db, "analysis_runs", "analyzer_version <> ?", [invalidation.analyzerVersion]);
      return {
        rule: "analyzer",
        deleted: { analysis_artifacts: artifacts, analysis_runs: runs },
        reused: ["tracks", "native_analysis", "show_plans"],
        note: `artifacts from analyzer versions other than ${invalidation.analyzerVersion} are invalid; TrackModels stay until reanalysis rewrites them`,
      };
    }
    case "planner": {
      // Planner change reuses TrackModels and regenerates plans.
      const plans = deleteWhere(db, "show_plans", "planner_version <> ?", [invalidation.plannerVersion]);
      return {
        rule: "planner",
        deleted: { show_plans: plans },
        reused: ["tracks", "analysis_artifacts", "native_analysis"],
        note: `plans from planner versions other than ${invalidation.plannerVersion} are invalid; TrackModels are reused`,
      };
    }
    case "venue": {
      // Venue change reuses TrackModels and semantic plans: the renderer
      // adapts, so nothing is deleted. Rows keyed by the old venue class stay
      // in the table but are never selected for the new class.
      return {
        rule: "venue",
        deleted: {},
        reused: ["tracks", "analysis_artifacts", "show_plans"],
        note: `venue class ${invalidation.venueClass} re-keys plan lookups; semantic plans are reused, not regenerated`,
      };
    }
    case "style": {
      // Style change regenerates plans for that style only.
      const plans = deleteWhere(db, "show_plans", "style_id = ?", [invalidation.styleId]);
      return {
        rule: "style",
        deleted: { show_plans: plans },
        reused: ["tracks", "analysis_artifacts"],
        note: `plans for style ${invalidation.styleId} are invalid; every other style keeps its plans`,
      };
    }
    case "library": {
      // Library change follows T-RBL-06: only the changed track's derived rows
      // are invalidated, keyed by source fingerprint.
      const artifacts = deleteWhere(
        db,
        "analysis_artifacts",
        "track_id = ? AND fingerprint <> ?",
        [invalidation.trackId, invalidation.sourceFingerprint],
      );
      const plans = deleteWhere(
        db,
        "show_plans",
        "track_id = ? AND source_fingerprint <> ?",
        [invalidation.trackId, invalidation.sourceFingerprint],
      );
      const native = deleteWhere(db, "native_analysis", "track_id = ?", [invalidation.trackId]);
      return {
        rule: "library",
        deleted: { analysis_artifacts: artifacts, show_plans: plans, native_analysis: native },
        reused: ["tracks"],
        note: `track ${invalidation.trackId} changed on disk; only its derived rows for other fingerprints are invalid`,
      };
    }
    case "config": {
      // A different config snapshot is a different plan cache entry.
      const plans = deleteWhere(db, "show_plans", "config_hash <> ?", [invalidation.configHash]);
      return {
        rule: "config",
        deleted: { show_plans: plans },
        reused: ["tracks", "analysis_artifacts"],
        note: `plans built under other config snapshots are invalid; current hash ${invalidation.configHash}`,
      };
    }
  }
}

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export const SCHEMA_PATH = new URL("../schema.sql", import.meta.url);
export function loadSchema(): string {
  return readFileSync(SCHEMA_PATH, "utf8");
}

// Cache versioning (§82): analyzer bumps invalidate analysis artifacts only;
// planner bumps reuse TrackModel and regenerate ShowPlan; venue changes reuse
// semantic plans. Invalidation is per-table, never wipe-all.
export interface CacheVersions { analyzer: string; planner: string }

export class Store {
  private db: DatabaseSync;
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(loadSchema());
  }

  saveTrack(id: string, identityJson: string, duration: number): void {
    this.db.prepare("INSERT OR REPLACE INTO tracks (id, identity_json, duration_seconds) VALUES (?, ?, ?)").run(id, identityJson, duration);
  }

  saveArtifact(trackId: string, analyzerVersion: string, artifactPath: string, fingerprint: string): void {
    this.db.prepare("INSERT OR REPLACE INTO analysis_artifacts (track_id, analyzer_version, artifact_path, fingerprint) VALUES (?, ?, ?, ?)").run(trackId, analyzerVersion, artifactPath, fingerprint);
  }

  // Returns artifact iff analyzer version + fingerprint match (§82).
  loadArtifact(trackId: string, analyzerVersion: string, fingerprint: string): string | null {
    const row = this.db.prepare("SELECT artifact_path FROM analysis_artifacts WHERE track_id = ? AND analyzer_version = ? AND fingerprint = ?").get(trackId, analyzerVersion, fingerprint) as { artifact_path: string } | undefined;
    return row?.artifact_path ?? null;
  }

  saveShowPlan(trackId: string, styleId: string, plannerVersion: string, seed: string, planJson: string): void {
    this.db.prepare("INSERT OR REPLACE INTO show_plans (track_id, style_id, planner_version, seed, plan_json) VALUES (?, ?, ?, ?, ?)").run(trackId, styleId, plannerVersion, seed, planJson);
  }

  loadShowPlan(trackId: string, styleId: string, plannerVersion: string): string | null {
    const row = this.db.prepare("SELECT plan_json FROM show_plans WHERE track_id = ? AND style_id = ? AND planner_version = ?").get(trackId, styleId, plannerVersion) as { plan_json: string } | undefined;
    return row?.plan_json ?? null;
  }

  close(): void {
    this.db.close();
  }
}

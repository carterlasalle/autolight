import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type ArtifactKeyParts,
  type ArtifactRow,
  CACHE_SCHEMA_VERSION,
  type PlanKeyParts,
  type PlanRow,
} from "./cache.js";
import {
  type DbDriver,
  type DriverPreference,
  type DriverStatus,
  esmModuleUrl,
  openDatabase,
  type SqlExec,
  type SqlParam,
} from "./driver.js";
import { migrate, migratorStatus, schemaVersion, tableNames } from "./migrate.js";

export * from "./cache.js";
export * from "./driver.js";
export * from "./fastpath.js";
export * from "./migrate.js";
export * from "./perf.js";
export * from "./replay.js";

// schema.sql is the readable snapshot of the head schema, used by the
// migration parity test. The path resolves lazily: importing this module must
// never throw in the esbuild CommonJS bundle of the Electron main process,
// where import.meta is empty and the snapshot file is not shipped.
export function schemaPath(): string | null {
  const metaUrl = esmModuleUrl();
  return metaUrl === null ? null : fileURLToPath(new URL("../schema.sql", metaUrl));
}

export function loadSchema(): string {
  const path = schemaPath();
  if (path === null) {
    throw new Error("schema.sql is only readable in an ESM runtime; the app applies the migrations instead");
  }
  return readFileSync(path, "utf8");
}

// Cache versioning (§82): analyzer bumps invalidate analysis artifacts only;
// planner bumps reuse TrackModel and regenerate ShowPlan; venue changes reuse
// semantic plans. Invalidation is per-table, never wipe-all.
export interface CacheVersions {
  analyzer: string;
  planner: string;
}

export interface StoreOptions {
  path?: string;
  driver?: DriverPreference;
  synchronous?: string;
  busyTimeoutMs?: number;
  // Only for a caller that already migrated the file itself.
  skipMigrations?: boolean;
}

export interface CalibrationRecord {
  sku: string;
  firmware: string;
  calibrationJson: string | null;
}

export interface ArtifactExtra {
  schemaVersion?: string;
  configHash?: string;
}

export interface PlanExtra {
  schemaVersion?: string;
  sourceFingerprint?: string;
  styleHash?: string;
  venueClass?: string;
  configHash?: string;
}

export class Store implements SqlExec {
  readonly driver: DbDriver;
  readonly status: DriverStatus;
  readonly journalMode: string;
  readonly synchronous: string;
  readonly busyTimeoutMs: number;
  readonly foreignKeys: boolean;

  constructor(pathOrOptions: string | StoreOptions = ":memory:") {
    const options: StoreOptions = typeof pathOrOptions === "string" ? { path: pathOrOptions } : pathOrOptions;
    const opened = openDatabase({
      path: options.path ?? ":memory:",
      ...(options.driver !== undefined ? { driver: options.driver } : {}),
      ...(options.synchronous !== undefined ? { synchronous: options.synchronous } : {}),
      ...(options.busyTimeoutMs !== undefined ? { busyTimeoutMs: options.busyTimeoutMs } : {}),
    });
    this.driver = opened.driver;
    this.status = opened.status;
    this.journalMode = opened.journalMode;
    this.synchronous = opened.synchronous;
    this.busyTimeoutMs = opened.busyTimeoutMs;
    this.foreignKeys = opened.foreignKeys;
    if (options.skipMigrations !== true) migrate(this.driver);
  }

  get version(): number {
    return schemaVersion(this.driver);
  }

  get pendingMigrations(): number[] {
    return migratorStatus(this.driver).pending;
  }

  get tables(): string[] {
    return tableNames(this.driver);
  }

  exec(sql: string): void {
    this.driver.exec(sql);
  }

  get<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): T | undefined {
    return this.driver.get<T>(sql, params);
  }

  all<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): T[] {
    return this.driver.all<T>(sql, params);
  }

  run(sql: string, params?: readonly SqlParam[]): void {
    this.driver.run(sql, params);
  }

  saveTrack(id: string, identityJson: string, duration: number | null = null): void {
    this.driver.run(
      `INSERT INTO tracks (id, identity_json, duration_seconds, created_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET identity_json = excluded.identity_json, duration_seconds = excluded.duration_seconds`,
      [id, identityJson, duration],
    );
  }

  saveArtifact(
    trackId: string,
    analyzerVersion: string,
    artifactPath: string,
    fingerprint: string,
    extra: ArtifactExtra = {},
  ): void {
    const schemaVersionValue = extra.schemaVersion ?? CACHE_SCHEMA_VERSION;
    const configHash = extra.configHash ?? "";
    this.driver.run(
      "DELETE FROM analysis_artifacts WHERE track_id = ? AND analyzer_version = ? AND fingerprint = ?",
      [trackId, analyzerVersion, fingerprint],
    );
    this.driver.run(
      `INSERT INTO analysis_artifacts
         (track_id, schema_version, analyzer_version, config_hash, fingerprint, artifact_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [trackId, schemaVersionValue, analyzerVersion, configHash, fingerprint, artifactPath],
    );
  }

  // Legacy lookup by track, analyzer version and fingerprint (spec 82 rows
  // carry more of the key; this returns the newest matching row).
  loadArtifact(trackId: string, analyzerVersion: string, fingerprint: string): string | null {
    const row = this.driver.get<{ artifact_path: string }>(
      `SELECT artifact_path FROM analysis_artifacts
       WHERE track_id = ? AND analyzer_version = ? AND fingerprint = ?
       ORDER BY rowid DESC LIMIT 1`,
      [trackId, analyzerVersion, fingerprint],
    );
    return row?.artifact_path ?? null;
  }

  artifactRow(parts: ArtifactKeyParts): ArtifactRow | undefined {
    return this.driver.get<ArtifactRow>(
      `SELECT * FROM analysis_artifacts
       WHERE track_id = ? AND schema_version = ? AND analyzer_version = ? AND config_hash = ? AND fingerprint = ?
       ORDER BY rowid DESC LIMIT 1`,
      [
        parts.trackId,
        parts.schemaVersion ?? CACHE_SCHEMA_VERSION,
        parts.analyzerVersion,
        parts.configHash,
        parts.sourceFingerprint,
      ],
    );
  }

  saveShowPlan(
    trackId: string,
    styleId: string,
    plannerVersion: string,
    seed: string,
    planJson: string,
    extra: PlanExtra = {},
  ): void {
    this.driver.run("DELETE FROM show_plans WHERE track_id = ? AND style_id = ? AND planner_version = ?", [
      trackId,
      styleId,
      plannerVersion,
    ]);
    this.driver.run(
      `INSERT INTO show_plans
         (track_id, style_id, planner_version, schema_version, source_fingerprint, style_hash, venue_class, config_hash, seed, plan_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        trackId,
        styleId,
        plannerVersion,
        extra.schemaVersion ?? CACHE_SCHEMA_VERSION,
        extra.sourceFingerprint ?? "",
        extra.styleHash ?? "",
        extra.venueClass ?? "",
        extra.configHash ?? "",
        seed,
        planJson,
      ],
    );
  }

  loadShowPlan(trackId: string, styleId: string, plannerVersion: string): string | null {
    const row = this.driver.get<{ plan_json: string }>(
      `SELECT plan_json FROM show_plans
       WHERE track_id = ? AND style_id = ? AND planner_version = ?
       ORDER BY rowid DESC LIMIT 1`,
      [trackId, styleId, plannerVersion],
    );
    return row?.plan_json ?? null;
  }

  planRow(parts: PlanKeyParts): PlanRow | undefined {
    return this.driver.get<PlanRow>(
      `SELECT * FROM show_plans
       WHERE track_id = ? AND style_id = ? AND planner_version = ? AND style_hash = ? AND venue_class = ? AND config_hash = ?
       ORDER BY rowid DESC LIMIT 1`,
      [
        parts.trackId,
        parts.styleId,
        parts.plannerVersion,
        parts.styleHash,
        parts.venueClass,
        parts.configHash,
      ],
    );
  }

  // Calibration keyed by hardware ID (§52); firmware change → caller flags
  // REQUALIFICATION REQUIRED, row stays until fresh qualification lands.
  saveCalibration(hardwareId: string, sku: string, firmware: string, calibrationJson: string): void {
    this.driver.run(
      `INSERT INTO devices (hardware_id, sku, firmware, calibration_json) VALUES (?, ?, ?, ?)
       ON CONFLICT(hardware_id) DO UPDATE SET sku = excluded.sku, firmware = excluded.firmware, calibration_json = excluded.calibration_json`,
      [hardwareId, sku, firmware, calibrationJson],
    );
  }

  loadCalibration(hardwareId: string): CalibrationRecord | null {
    const row = this.driver.get<{ sku: string; firmware: string; calibration_json: string | null }>(
      "SELECT sku, firmware, calibration_json FROM devices WHERE hardware_id = ?",
      [hardwareId],
    );
    if (!row) return null;
    return { sku: row.sku, firmware: row.firmware, calibrationJson: row.calibration_json };
  }

  saveVenue(id: string, name: string, layoutJson: string): void {
    this.driver.run(
      `INSERT INTO venues (id, name, layout_json, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, layout_json = excluded.layout_json, updated_at = excluded.updated_at`,
      [id, name, layoutJson],
    );
  }

  loadVenue(id: string): string | null {
    const row = this.driver.get<{ layout_json: string }>("SELECT layout_json FROM venues WHERE id = ?", [id]);
    return row?.layout_json ?? null;
  }

  // Qualification records are per device, transport and firmware (T-GOV-11).
  saveQualification(
    deviceId: string,
    transport: string,
    firmware: string,
    stepsJson: string,
    passed: boolean,
  ): void {
    this.driver.run(
      `INSERT INTO qualification_records (device_id, transport, firmware, steps_json, passed, recorded_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [deviceId, transport, firmware, stepsJson, passed ? 1 : 0],
    );
  }

  saveCapabilityStatus(name: string, status: string, reason: string | null): void {
    this.driver.run(
      `INSERT INTO capability_status (name, status, reason, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(name) DO UPDATE SET status = excluded.status, reason = excluded.reason, updated_at = excluded.updated_at`,
      [name, status, reason],
    );
  }

  saveConfigValue(scope: string, key: string, valueJson: string): void {
    this.driver.run(
      `INSERT INTO config_values (scope, key, value_json, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(scope, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [scope, key, valueJson],
    );
  }

  close(): void {
    this.driver.close();
  }
}

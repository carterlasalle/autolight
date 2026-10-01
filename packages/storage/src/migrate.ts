import type { SqlExec } from "./driver.js";

// Versioned schema history (T-DATA-02, spec 81). `schema.sql` is the readable
// snapshot of the head schema; `migrate.test.ts` compares the two so the
// snapshot can never drift from the migrations that actually run.
//
// Migration 1 is the schema the first release shipped (7 tables).
// Migration 2 adds every spec 81 table this plan still owed, the tables the
// plan needs (track_aliases, analysis_jobs, config_values, rooms,
// room_anchors, qualification_records, capability_status) and widens the
// artifact and plan cache keys so they carry schema version, analyzer and
// planner versions, source fingerprint, style hash, venue capability class
// and config snapshot hash (spec 82).

const BASELINE_SQL = `
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  identity_json TEXT NOT NULL,
  duration_seconds REAL
);
CREATE TABLE IF NOT EXISTS analysis_artifacts (
  track_id TEXT PRIMARY KEY,
  analyzer_version TEXT NOT NULL,
  artifact_path TEXT NOT NULL,
  fingerprint TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS show_plans (
  track_id TEXT NOT NULL,
  style_id TEXT NOT NULL,
  planner_version TEXT NOT NULL,
  seed TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  PRIMARY KEY (track_id, style_id, planner_version)
);
CREATE TABLE IF NOT EXISTS devices (
  hardware_id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  firmware TEXT NOT NULL,
  calibration_json TEXT
);
CREATE TABLE IF NOT EXISTS venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  layout_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  log_path TEXT
);
CREATE TABLE IF NOT EXISTS diagnostic_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  module TEXT NOT NULL,
  severity TEXT NOT NULL,
  event_json TEXT NOT NULL
);
`;

const SPEC81_SQL = `
ALTER TABLE tracks ADD COLUMN created_at TEXT;
ALTER TABLE venues ADD COLUMN updated_at TEXT;
ALTER TABLE sessions ADD COLUMN ended_at TEXT;
ALTER TABLE sessions ADD COLUMN app_version TEXT;

CREATE TABLE IF NOT EXISTS source_identities (
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_key TEXT NOT NULL,
  added_at TEXT,
  PRIMARY KEY (track_id, source, source_key)
);
CREATE TABLE IF NOT EXISTS native_analysis (
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  bpm REAL,
  first_beat_ms REAL,
  grid_json TEXT NOT NULL,
  analyzed_at TEXT,
  PRIMARY KEY (track_id, source)
);
CREATE TABLE IF NOT EXISTS analysis_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  analyzer_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS show_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id TEXT NOT NULL,
  style_id TEXT NOT NULL,
  edit_json TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS device_capabilities (
  device_id TEXT NOT NULL REFERENCES devices(hardware_id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  status TEXT NOT NULL,
  detail_json TEXT,
  updated_at TEXT,
  PRIMARY KEY (device_id, capability)
);
CREATE TABLE IF NOT EXISTS device_calibrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hardware_id TEXT NOT NULL REFERENCES devices(hardware_id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  firmware TEXT NOT NULL,
  transport TEXT NOT NULL,
  measured_latency_ms REAL,
  calibration_json TEXT NOT NULL,
  qualified_at TEXT,
  UNIQUE (hardware_id, sku, firmware, transport)
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  geometry_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS room_anchors (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  fixture_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  z REAL NOT NULL,
  rotation_deg REAL,
  cell_map_json TEXT
);
CREATE TABLE IF NOT EXISTS fixture_placements (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  fixture_id TEXT NOT NULL,
  x0 REAL,
  x1 REAL,
  cell_map_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fixture_groups (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  members_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS show_styles (
  id TEXT PRIMARY KEY,
  style_json TEXT NOT NULL,
  style_hash TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS protocol_versions (
  protocol TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  supported INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  PRIMARY KEY (protocol, version, platform)
);
CREATE TABLE IF NOT EXISTS track_aliases (
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  alias_id TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT,
  PRIMARY KEY (track_id, alias_id)
);
CREATE TABLE IF NOT EXISTS analysis_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS config_values (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT,
  PRIMARY KEY (scope, key)
);
CREATE TABLE IF NOT EXISTS qualification_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  transport TEXT NOT NULL,
  firmware TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  passed INTEGER NOT NULL,
  recorded_at TEXT
);
CREATE TABLE IF NOT EXISTS capability_status (
  name TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  reason TEXT,
  updated_at TEXT
);

CREATE TABLE analysis_artifacts_v2 (
  track_id TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1',
  analyzer_version TEXT NOT NULL,
  config_hash TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL,
  artifact_path TEXT NOT NULL,
  created_at TEXT,
  PRIMARY KEY (track_id, schema_version, analyzer_version, config_hash, fingerprint)
);
INSERT INTO analysis_artifacts_v2
  (track_id, schema_version, analyzer_version, config_hash, fingerprint, artifact_path, created_at)
  SELECT track_id, '1', analyzer_version, '', fingerprint, artifact_path, datetime('now') FROM analysis_artifacts;
DROP TABLE analysis_artifacts;
ALTER TABLE analysis_artifacts_v2 RENAME TO analysis_artifacts;

CREATE TABLE show_plans_v2 (
  track_id TEXT NOT NULL,
  style_id TEXT NOT NULL,
  planner_version TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1',
  source_fingerprint TEXT NOT NULL DEFAULT '',
  style_hash TEXT NOT NULL DEFAULT '',
  venue_class TEXT NOT NULL DEFAULT '',
  config_hash TEXT NOT NULL DEFAULT '',
  seed TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  created_at TEXT,
  PRIMARY KEY (track_id, style_id, planner_version, style_hash, venue_class, config_hash)
);
INSERT INTO show_plans_v2
  (track_id, style_id, planner_version, schema_version, source_fingerprint, style_hash, venue_class, config_hash, seed, plan_json, created_at)
  SELECT track_id, style_id, planner_version, '1', '', '', '', '', seed, plan_json, datetime('now') FROM show_plans;
DROP TABLE show_plans;
ALTER TABLE show_plans_v2 RENAME TO show_plans;
`;

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "baseline", sql: BASELINE_SQL },
  { version: 2, name: "spec-81-schema", sql: SPEC81_SQL },
];

export const SCHEMA_VERSION = 2;

// Spec 81 names 17 tables at minimum.
export const SPEC81_TABLES = [
  "tracks",
  "source_identities",
  "native_analysis",
  "analysis_runs",
  "analysis_artifacts",
  "show_plans",
  "show_edits",
  "devices",
  "device_capabilities",
  "device_calibrations",
  "venues",
  "fixture_placements",
  "fixture_groups",
  "show_styles",
  "sessions",
  "diagnostic_events",
  "protocol_versions",
] as const;

// Tables this plan adds on top of spec 81.
export const PLAN_TABLES = [
  "track_aliases",
  "analysis_jobs",
  "config_values",
  "rooms",
  "room_anchors",
  "qualification_records",
  "capability_status",
] as const;

export const REQUIRED_TABLES: readonly string[] = [...SPEC81_TABLES, ...PLAN_TABLES];

export interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export function tableNames(db: SqlExec): string[] {
  return db
    .all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .map((row) => row.name);
}

export function hasTable(db: SqlExec, name: string): boolean {
  const row = db.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]);
  return row !== undefined;
}

export function columnsOf(db: SqlExec, table: string): ColumnInfo[] {
  return db.all<ColumnInfo>(`PRAGMA table_info(${table})`).map((row) => ({
    name: String(row.name),
    type: String(row.type),
    notnull: Number(row.notnull),
    dflt_value: row.dflt_value === null || row.dflt_value === undefined ? null : String(row.dflt_value),
    pk: Number(row.pk),
  }));
}

function ensureBookkeeping(db: SqlExec): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`);
}

function appliedRows(db: SqlExec): { version: number; name: string; applied_at: string }[] {
  return db.all<{ version: number; name: string; applied_at: string }>(
    "SELECT version, name, applied_at FROM schema_migrations ORDER BY version",
  );
}

export function schemaVersion(db: SqlExec): number {
  ensureBookkeeping(db);
  const rows = appliedRows(db);
  return rows.reduce((max, row) => Math.max(max, Number(row.version)), 0);
}

export interface MigratorStatus {
  version: number;
  applied: { version: number; name: string; applied_at: string }[];
  pending: number[];
}

export function migratorStatus(db: SqlExec): MigratorStatus {
  ensureBookkeeping(db);
  const applied = appliedRows(db);
  const version = applied.reduce((max, row) => Math.max(max, Number(row.version)), 0);
  return {
    version,
    applied,
    pending: MIGRATIONS.filter((m) => m.version > version).map((m) => m.version),
  };
}

export interface MigrateResult {
  from: number;
  to: number;
  applied: number[];
  adoptedBaseline: boolean;
}

// A database written by the first release has the baseline tables and no
// bookkeeping: adopt it at version 1 rather than replaying migration 1.
function adoptLegacyBaseline(db: SqlExec): boolean {
  ensureBookkeeping(db);
  if (appliedRows(db).length > 0) return false;
  if (!hasTable(db, "tracks")) return false;
  db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", [
    1,
    "baseline",
    new Date().toISOString(),
  ]);
  return true;
}

export function migrate(db: SqlExec, options: { target?: number } = {}): MigrateResult {
  const adoptedBaseline = adoptLegacyBaseline(db);
  const from = schemaVersion(db);
  const head = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
  const target = options.target ?? head;
  if (target < from) {
    throw new Error(
      `downgrade refused: database is at schema version ${from} and target is ${target}; ` +
        "restore a backup instead of migrating backwards",
    );
  }
  const applied: number[] = [];
  for (const migration of MIGRATIONS) {
    if (migration.version <= from || migration.version > target) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", [
        migration.version,
        migration.name,
        new Date().toISOString(),
      ]);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${migration.version} (${migration.name}) failed: ${(error as Error).message}`);
    }
    applied.push(migration.version);
  }
  return { from, to: schemaVersion(db), applied, adoptedBaseline };
}

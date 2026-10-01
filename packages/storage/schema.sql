-- AutoLight application database (spec 80, 81). This file is the readable
-- snapshot of the head schema; the migrations in src/migrate.ts are what
-- actually run, and migrate.test.ts asserts the two agree. The database is
-- completely separate from Rekordbox and Serato data.
--
-- Pragmas (WAL, synchronous, busy_timeout, foreign_keys) are applied by
-- src/driver.ts from config at open time, never here.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  identity_json TEXT NOT NULL,
  duration_seconds REAL,
  created_at TEXT
);

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

CREATE TABLE IF NOT EXISTS analysis_artifacts (
  track_id TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1',
  analyzer_version TEXT NOT NULL,
  config_hash TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL,
  artifact_path TEXT NOT NULL,
  created_at TEXT,
  PRIMARY KEY (track_id, schema_version, analyzer_version, config_hash, fingerprint)
);

CREATE TABLE IF NOT EXISTS show_plans (
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

CREATE TABLE IF NOT EXISTS show_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id TEXT NOT NULL,
  style_id TEXT NOT NULL,
  edit_json TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  hardware_id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  firmware TEXT NOT NULL,
  calibration_json TEXT
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

CREATE TABLE IF NOT EXISTS venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  updated_at TEXT
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

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  log_path TEXT,
  ended_at TEXT,
  app_version TEXT
);

CREATE TABLE IF NOT EXISTS diagnostic_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  module TEXT NOT NULL,
  severity TEXT NOT NULL,
  event_json TEXT NOT NULL
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

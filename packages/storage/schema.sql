PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, identity_json TEXT NOT NULL, duration_seconds REAL);
CREATE TABLE IF NOT EXISTS analysis_artifacts (track_id TEXT PRIMARY KEY, analyzer_version TEXT NOT NULL, artifact_path TEXT NOT NULL, fingerprint TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS show_plans (track_id TEXT NOT NULL, style_id TEXT NOT NULL, planner_version TEXT NOT NULL, seed TEXT NOT NULL, plan_json TEXT NOT NULL, PRIMARY KEY (track_id, style_id, planner_version));
CREATE TABLE IF NOT EXISTS devices (hardware_id TEXT PRIMARY KEY, sku TEXT NOT NULL, firmware TEXT NOT NULL, calibration_json TEXT);
CREATE TABLE IF NOT EXISTS venues (id TEXT PRIMARY KEY, name TEXT NOT NULL, layout_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, log_path TEXT);
CREATE TABLE IF NOT EXISTS diagnostic_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, module TEXT NOT NULL, severity TEXT NOT NULL, event_json TEXT NOT NULL);

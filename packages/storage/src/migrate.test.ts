import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type SqlExec } from "./driver.js";
import { loadSchema, Store } from "./index.js";
import {
  columnsOf,
  MIGRATIONS,
  migrate,
  migratorStatus,
  PLAN_TABLES,
  REQUIRED_TABLES,
  SCHEMA_VERSION,
  SPEC81_TABLES,
  tableNames,
} from "./migrate.js";

function tempDb(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "autolight-migrate-"));
  return { dir, file: join(dir, "autolight.db") };
}

// Per-table column signature, so the readable schema.sql snapshot and the
// migrations cannot drift apart unnoticed.
function schemaShape(db: SqlExec): Record<string, string[]> {
  const shape: Record<string, string[]> = {};
  for (const table of tableNames(db)) {
    shape[table] = columnsOf(db, table)
      .map((column) => `${column.name}:${column.type}:${column.notnull}:${column.dflt_value ?? ""}:${column.pk}`)
      .sort();
  }
  return shape;
}

function seedPreviousVersion(db: SqlExec): void {
  db.run("INSERT INTO tracks (id, identity_json, duration_seconds) VALUES (?, ?, ?)", ["t1", '{"id":"t1"}', 200]);
  db.run(
    "INSERT INTO analysis_artifacts (track_id, analyzer_version, artifact_path, fingerprint) VALUES (?, ?, ?, ?)",
    ["t1", "0.1.0", "/cache/t1.json", "fp1"],
  );
  db.run(
    "INSERT INTO show_plans (track_id, style_id, planner_version, seed, plan_json) VALUES (?, ?, ?, ?, ?)",
    ["t1", "club", "0.1.0", "seed-1", '{"trackId":"t1","cues":[]}'],
  );
  db.run("INSERT INTO venues (id, name, layout_json) VALUES (?, ?, ?)", ["home", "Home", '{"fixtures":[]}']);
  db.run("INSERT INTO devices (hardware_id, sku, firmware, calibration_json) VALUES (?, ?, ?, ?)", [
    "hw1",
    "H6076",
    "1.0",
    '{"segmentCount":14}',
  ]);
}

describe("schema migrations (T-DATA-02, spec 81)", () => {
  it("creates every spec 81 table plus this plan's tables on a fresh database (P-81)", () => {
    const store = new Store();
    try {
      expect(SPEC81_TABLES.length).toBe(17);
      expect(PLAN_TABLES.length).toBe(7);
      const tables = store.tables;
      for (const table of REQUIRED_TABLES) expect(tables, `missing table ${table}`).toContain(table);
      expect(tables.length).toBeGreaterThanOrEqual(REQUIRED_TABLES.length + 1);
      expect(store.version).toBe(SCHEMA_VERSION);
      expect(store.pendingMigrations).toEqual([]);
      console.info(
        `P-81: ${SPEC81_TABLES.length} spec-81 tables + ${PLAN_TABLES.length} plan tables + schema_migrations = ` +
          `${tables.length} tables, schema v${store.version}`,
      );
    } finally {
      store.close();
    }
  });

  it("migrates a database at the previous version with data, keeping the rows (P-81)", () => {
    const { dir, file } = tempDb();
    const opened = openDatabase({ path: file });
    try {
      const first = migrate(opened.driver, { target: 1 });
      expect(first).toMatchObject({ from: 0, to: 1, applied: [1] });
      seedPreviousVersion(opened.driver);

      const second = migrate(opened.driver);
      expect(second).toMatchObject({ from: 1, to: SCHEMA_VERSION, applied: [2] });

      const artifact = opened.driver.get<{ artifact_path: string; schema_version: string; config_hash: string }>(
        "SELECT artifact_path, schema_version, config_hash FROM analysis_artifacts WHERE track_id = ?",
        ["t1"],
      );
      expect(artifact).toMatchObject({ artifact_path: "/cache/t1.json", schema_version: "1", config_hash: "" });

      const plan = opened.driver.get<{ plan_json: string; schema_version: string; style_hash: string }>(
        "SELECT plan_json, schema_version, style_hash FROM show_plans WHERE track_id = ?",
        ["t1"],
      );
      expect(plan?.plan_json).toBe('{"trackId":"t1","cues":[]}');
      expect(plan?.schema_version).toBe("1");
      expect(plan?.style_hash).toBe("");

      const venue = opened.driver.get<{ layout_json: string }>("SELECT layout_json FROM venues WHERE id = ?", ["home"]);
      expect(venue?.layout_json).toBe('{"fixtures":[]}');
      const device = opened.driver.get<{ firmware: string }>("SELECT firmware FROM devices WHERE hardware_id = ?", ["hw1"]);
      expect(device?.firmware).toBe("1.0");
      // Tables the widened schema needs exist and are writable.
      opened.driver.run(
        "INSERT INTO device_calibrations (hardware_id, sku, firmware, transport, calibration_json) VALUES (?, ?, ?, ?, ?)",
        ["hw1", "H6076", "1.0", "lan", '{"measuredLatencyMs":40}'],
      );
      expect(opened.driver.all("SELECT id FROM device_calibrations").length).toBe(1);
    } finally {
      opened.driver.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adopts a database written before migrations existed", () => {
    const { dir, file } = tempDb();
    const opened = openDatabase({ path: file });
    try {
      opened.driver.exec(MIGRATIONS[0]?.sql ?? "");
      seedPreviousVersion(opened.driver);
      const result = migrate(opened.driver);
      expect(result.adoptedBaseline).toBe(true);
      expect(result.from).toBe(1);
      expect(result.applied).toEqual([2]);
      expect(migratorStatus(opened.driver).applied.map((row) => row.version)).toEqual([1, 2]);
    } finally {
      opened.driver.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent", () => {
    const store = new Store();
    try {
      const again = migrate(store);
      expect(again.applied).toEqual([]);
      expect(again.to).toBe(SCHEMA_VERSION);
    } finally {
      store.close();
    }
  });

  it("refuses a downgrade with a clear message", () => {
    const store = new Store();
    try {
      expect(() => migrate(store, { target: 1 })).toThrow(/downgrade refused/);
      expect(() => migrate(store, { target: 1 })).toThrow(
        new RegExp(`database is at schema version ${SCHEMA_VERSION} and target is 1`),
      );
      expect(store.version).toBe(SCHEMA_VERSION);
    } finally {
      store.close();
    }
  });

  it("rolls a failed migration back instead of leaving a half schema", () => {
    const { dir, file } = tempDb();
    const opened = openDatabase({ path: file });
    try {
      migrate(opened.driver, { target: 1 });
      opened.driver.exec("CREATE TABLE analysis_artifacts_v2 (track_id TEXT)");
      expect(() => migrate(opened.driver)).toThrow(/migration 2 \(spec-81-schema\) failed/);
      expect(opened.driver.get("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")).toMatchObject({ version: 1 });
      expect(tableNames(opened.driver)).not.toContain("rooms");
    } finally {
      opened.driver.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps schema.sql equal to what the migrations build", () => {
    const migrated = openDatabase({ path: ":memory:" });
    const snapshot = openDatabase({ path: ":memory:" });
    try {
      migrate(migrated.driver);
      snapshot.driver.exec(loadSchema());
      const fromMigrations = schemaShape(migrated.driver);
      const fromFile = schemaShape(snapshot.driver);
      expect(Object.keys(fromFile).sort()).toEqual(Object.keys(fromMigrations).sort());
      expect(fromFile).toEqual(fromMigrations);
    } finally {
      migrated.driver.close();
      snapshot.driver.close();
    }
  });
});

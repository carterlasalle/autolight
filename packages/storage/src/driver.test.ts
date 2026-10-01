import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DbDriver, describeDriver, moduleStatus, openDatabase } from "./driver.js";
import { migrate, REQUIRED_TABLES, tableNames } from "./migrate.js";

function tempDb(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "autolight-db-"));
  return { dir, file: join(dir, "autolight.db") };
}

// A slice of the storage layer every driver must run identically: migrate the
// file, write, read back an update.
function exercise(driver: DbDriver): { tables: string[]; track: string | undefined } {
  migrate(driver);
  driver.run("INSERT INTO tracks (id, identity_json, duration_seconds) VALUES (?, ?, ?)", ["t1", '{"id":"t1"}', 12]);
  driver.run("INSERT INTO tracks (id, identity_json, duration_seconds) VALUES (?, ?, ?)", ["t2", '{"id":"t2"}', 30]);
  driver.run("UPDATE tracks SET duration_seconds = ? WHERE id = ?", [31, "t2"]);
  const track = driver.get<{ id: string }>("SELECT id FROM tracks WHERE duration_seconds = ?", [31]);
  return { tables: tableNames(driver), track: track?.id };
}

describe("storage driver (T-DATA-01, DS-06)", () => {
  it("opens the application database in WAL mode and reads every pragma back (P-80)", () => {
    const { dir, file } = tempDb();
    const opened = openDatabase({ path: file, driver: "auto", synchronous: "NORMAL", busyTimeoutMs: 4000 });
    try {
      expect(opened.journalMode.toLowerCase()).toBe("wal");
      expect(opened.synchronous).toBe("NORMAL");
      expect(opened.busyTimeoutMs).toBe(4000);
      expect(opened.foreignKeys).toBe(true);
      // WAL is engaged, not just requested: a write creates the -wal sidecar.
      opened.driver.exec("CREATE TABLE probe (x INTEGER)");
      opened.driver.run("INSERT INTO probe (x) VALUES (1)");
      const sidecars = readdirSync(dir);
      expect(sidecars.some((name) => name.endsWith("-wal"))).toBe(true);
      console.info(
        `P-80: ${describeDriver(opened.status)}, journal ${opened.journalMode}, synchronous ${opened.synchronous}, ` +
          `busyTimeout ${opened.busyTimeoutMs} ms, foreignKeys ${opened.foreignKeys}`,
      );
      expect(describeDriver(opened.status)).toContain(opened.status.chosen);
    } finally {
      opened.driver.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports the driver actually in use, with a reason when it falls back", () => {
    const better = moduleStatus("better-sqlite3");
    const { dir, file } = tempDb();
    const opened = openDatabase({ path: file });
    try {
      if (better.available) {
        expect(opened.status.chosen).toBe("better-sqlite3");
        expect(opened.status.fellBack).toBe(false);
        expect(opened.status.fallbackReason).toBeNull();
      } else {
        expect(opened.status.chosen).toBe("node-sqlite");
        expect(opened.status.fellBack).toBe(true);
        expect(opened.status.fallbackReason).toBe(better.detail);
        console.info(`better-sqlite3 is not installed in this runtime: ${better.detail}`);
      }
      // The built-in driver must load inside this runtime (spec 80 self-test).
      expect(opened.status.nodeSqlite.available).toBe(true);
      expect(opened.status.nodeVersion).toBe(process.versions.node);
    } finally {
      opened.driver.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs migrations and reads back identically on every driver that loads (driver parity)", () => {
    const better = moduleStatus("better-sqlite3");
    const { dir } = tempDb();
    const drivers: DbDriver[] = [];
    const results: Record<string, { tables: string[]; track: string | undefined }> = {};
    try {
      const requested = better.available ? ["better-sqlite3", "node-sqlite"] : ["node-sqlite"];
      for (const name of requested) {
        const opened = openDatabase({
          path: join(dir, `${name}.db`),
          driver: name === "better-sqlite3" ? "better-sqlite3" : "node-sqlite",
        });
        drivers.push(opened.driver);
        expect(opened.driver.name).toBe(name);
        results[name] = exercise(opened.driver);
      }
      const builtIn = results["node-sqlite"];
      expect(builtIn?.track).toBe("t2");
      for (const table of REQUIRED_TABLES) expect(builtIn?.tables).toContain(table);
      if (better.available) {
        expect(results["better-sqlite3"]?.tables).toEqual(builtIn?.tables);
        expect(results["better-sqlite3"]?.track).toBe(builtIn?.track);
      } else {
        console.info("driver parity ran on node-sqlite only; better-sqlite3 is not installed in this runtime");
      }
      console.info(`driver parity exercised: ${Object.keys(results).join(", ")}`);
    } finally {
      for (const driver of drivers) driver.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a bad storage.sqlite.synchronous value and names the alternatives", () => {
    const { dir, file } = tempDb();
    try {
      expect(() => openDatabase({ path: file, synchronous: "SOMETIMES" })).toThrow(
        /invalid storage\.sqlite\.synchronous "SOMETIMES".*OFF, NORMAL, FULL, EXTRA/,
      );
      expect(() => openDatabase({ path: file, busyTimeoutMs: -1 })).toThrow(/busyTimeoutMs/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails loudly when a driver is requested and cannot open it", () => {
    // A directory is not a database file: a requested driver must never be
    // silently swapped for another one.
    expect(() => openDatabase({ path: "/", driver: "better-sqlite3" })).toThrow(/better-sqlite3 was requested/);
  });

  it("keeps :memory: usable for tests without pretending it is WAL", () => {
    const opened = openDatabase({ path: ":memory:" });
    try {
      expect(opened.journalMode.toLowerCase()).toBe("memory");
      expect(opened.foreignKeys).toBe(true);
      migrate(opened.driver);
      expect(tableNames(opened.driver)).toContain("tracks");
    } finally {
      opened.driver.close();
    }
  });
});

// P-4.1-readonly-library: the fixture database opens read-only, every row type
// loads, and an attempted write throws (T-RBL-01, T-RBL-02; F-RBL-01,
// F-RBL-08).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mapTrackRow, RekordboxReader } from "./db.js";
import { cipherDriverAvailable, LibraryDbError, openReadOnly } from "./driver.js";
import { writeFixtureDb, type FixtureSummary } from "./test-fixtures.js";

const created: string[] = [];

function fixture(): { root: string; dbPath: string; sharePath: string; summary: FixtureSummary } {
  const root = mkdtempSync(join(tmpdir(), "autolight-rbl-db-"));
  created.push(root);
  const dbPath = join(root, "master.db");
  const sharePath = join(root, "share");
  const summary = writeFixtureDb({ dbPath, sharePath, audioDir: join(root, "audio") });
  return { root, dbPath, sharePath, summary };
}

afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe("rekordbox reader", () => {
  it("opens the fixture read-only and lists tracks, playlists and history", async () => {
    const { dbPath, sharePath, summary } = fixture();
    const reader = await RekordboxReader.open({ dbPath, sharePath });
    try {
      expect(reader.driver).toBe("node:sqlite");
      expect(reader.counts()).toEqual(summary.counts);
      expect(reader.dbVersion()).toBe("6000");

      const page = reader.trackRows({ limit: 4, offset: 0 });
      expect(page).toHaveLength(4);
      const aurora = reader.trackRow("101");
      expect(aurora?.["Title"]).toBe("Aurora");
      expect(aurora?.["artistName"]).toBe("Nova");
      expect(aurora?.["albumName"]).toBe("First Light");
      expect(aurora?.["keyName"]).toBe("8A");
      expect(aurora?.["colorName"]).toBe("Red");
      expect(aurora?.["BPM"]).toBe(128);

      const playlists = reader.playlistRows();
      expect(playlists.map((row) => row["ID"])).toEqual(["p1", "f1", "p2"]);
      expect(reader.songPlaylistRows("p1").map((entry) => entry.rekordboxId)).toEqual(["101", "102"]);

      const history = reader.historyRows();
      expect(history).toHaveLength(1);
      expect(reader.songHistoryRows("h1").map((entry) => entry.trackNo)).toEqual([1, 2, 3]);
      expect(reader.historyTrackCounts()).toEqual({ h1: 3 });
    } finally {
      reader.close();
    }
  });

  it("rejects a write through the handle it holds", async () => {
    const { dbPath, sharePath } = fixture();
    const reader = await RekordboxReader.open({ dbPath, sharePath });
    try {
      const probe = reader.probeWrite();
      expect(probe.rejected).toBe(true);
      expect(probe.error).toMatch(/readonly|read-only|query_only/i);
      expect(reader.counts().tracks).toBe(4);
    } finally {
      reader.close();
    }
  });

  it("resolves ANLZ sets into typed statuses instead of throwing", async () => {
    const { dbPath, sharePath } = fixture();
    const reader = await RekordboxReader.open({ dbPath, sharePath });
    try {
      const track = (id: string) => {
        const row = reader.trackRow(id);
        if (row === undefined) throw new Error(`fixture row ${id} missing`);
        return mapTrackRow(row, { sharePath });
      };
      const full = track("101");
      expect(full.anlz.statuses).toEqual(["audio-ok", "anlz-ok"]);
      expect(full.anlz.anlzDir).toBe(join(sharePath, "PIONEER", "USBANLZ", "101", "101"));
      expect(full.anlz.dat?.exists).toBe(true);
      expect(full.anlz.ext?.exists).toBe(true);
      expect(full.anlz.ex2?.exists).toBe(true);
      expect(full.anlz.dat?.sizeBytes).toBeGreaterThan(0);

      const partial = track("102");
      expect(partial.anlz.statuses).toEqual(["audio-ok", "anlz-partial"]);
      expect(partial.anlz.ext?.exists).toBe(false);

      const missing = track("103");
      expect(missing.anlz.statuses).toEqual(["audio-ok", "anlz-missing"]);
      expect(missing.anlz.anlzDir).toBe(join(sharePath, "PIONEER", "USBANLZ", "103", "103"));

      const gone = track("104");
      expect(gone.anlz.statuses).toEqual(["audio-missing", "anlz-missing"]);
      expect(gone.anlz.anlzDir).toBeNull();
    } finally {
      reader.close();
    }
  });

  it("paginates and searches without touching the database", async () => {
    const { dbPath, sharePath } = fixture();
    const reader = await RekordboxReader.open({ dbPath, sharePath });
    try {
      expect(reader.trackRows({ limit: 2, offset: 0 }).map((row) => row["ID"])).toEqual(["101", "102"]);
      expect(reader.trackRows({ limit: 2, offset: 2 }).map((row) => row["ID"])).toEqual(["103", "104"]);
      expect(reader.trackCount()).toBe(4);
      expect(reader.trackRows({ search: "aurora", limit: 10 }).map((row) => row["ID"])).toEqual(["101"]);
      expect(reader.trackCount("nova")).toBe(2);
      expect(reader.trackCount("nothing-matches")).toBe(0);
    } finally {
      reader.close();
    }
  });

  it("reports a missing database and a non-SQLite file as typed errors", async () => {
    const root = mkdtempSync(join(tmpdir(), "autolight-rbl-bad-"));
    created.push(root);
    await expect(openReadOnly(join(root, "absent.db"))).rejects.toMatchObject({ code: "not-found" });

    const junk = join(root, "junk.db");
    writeFileSync(junk, "this is not a database");
    await expect(openReadOnly(junk)).rejects.toBeInstanceOf(LibraryDbError);
    await expect(openReadOnly(junk)).rejects.toMatchObject({ code: "not-a-database" });
    // A key selects the SQLCipher driver, which is optional and absent here.
    const cipherAvailable = await cipherDriverAvailable();
    const withKey = openReadOnly(junk, "402fd482");
    if (cipherAvailable) await expect(withKey).rejects.toBeInstanceOf(LibraryDbError);
    else await expect(withKey).rejects.toMatchObject({ code: "cipher-module-missing" });
  });
});

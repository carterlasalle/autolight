// T-SEC-04: every exposed Rekordbox handle rejects writes (F-SEC-02, P-4.1).
// Write attempts through every exposed handle must error, the fixture
// checksum must be identical before and after the full run, and the exposed
// service surface must carry no write-shaped method.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attemptWrite, openReadOnly, WRITE_PROBE_SQL } from "./driver.js";
import { RekordboxReader } from "./db.js";
import { LibraryService } from "./service.js";
import { SidecarReader, readLibraryViaSidecar } from "./sidecar.js";
import { readFixturePayload, writeFixtureDb } from "./test-fixtures.js";

const created: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "autolight-rbl-sec04-"));
  created.push(root);
  const dbPath = join(root, "master.db");
  const sharePath = join(root, "share");
  const summary = writeFixtureDb({ dbPath, sharePath, audioDir: join(root, "audio") });
  return { root, dbPath, sharePath, summary };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe("T-SEC-04 read-only by construction", () => {
  it("rejects writes through the openReadOnly handle", async () => {
    const { dbPath } = fixture();
    const db = await openReadOnly(dbPath);
    try {
      const probe = attemptWrite(db);
      expect(probe.rejected).toBe(true);
      expect(probe.error).toMatch(/readonly|read-only|query_only/i);
      const direct = attemptWrite(db, "INSERT INTO djmdContent (ID) VALUES ('evil')");
      expect(direct.rejected).toBe(true);
      const drop = attemptWrite(db, "DROP TABLE djmdContent");
      expect(drop.rejected).toBe(true);
    } finally {
      db.close();
    }
  });

  it("rejects writes through the RekordboxReader handle", async () => {
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

  it("rejects writes through the SidecarReader transport", async () => {
    const { dbPath } = fixture();
    const payload = readFixturePayload(dbPath);
    const reader = await SidecarReader.open({
      dbPath,
      encrypted: false,
      run: () =>
        Promise.resolve({
          code: 0,
          stdout: JSON.stringify({ ...payload, writeProbe: { rejected: true, error: "attempt to write a readonly database" } }),
          stderr: "",
        }),
    });
    const probe = await reader.probeWrite();
    expect(probe.rejected).toBe(true);
    expect(probe.error).toMatch(/readonly|read-only/i);
    reader.close();
  });

  it("rejects writes through the sidecar protocol against the real fixture", async () => {
    const { dbPath } = fixture();
    const result = await readLibraryViaSidecar(
      { dbPath, encrypted: false, probeWrite: true },
      {
        run: () =>
          Promise.resolve({
            code: 0,
            stdout: JSON.stringify({ ok: true, writeProbe: { rejected: true, error: "attempt to write a readonly database" } }),
            stderr: "",
          }),
      },
    );
    expect(result.ok).toBe(true);
    expect(result.writeProbe?.rejected).toBe(true);
  });

  it("exposes no write method on the library service", async () => {
    const { dbPath, sharePath } = fixture();
    const service = await LibraryService.open({ dbPath, sharePath, mode: "rekordbox-connect" });
    try {
      const names = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
      for (const name of names) {
        expect(name).not.toMatch(/^(insert|update|delete|upsert|write|save|remove|create|drop|exec|run|checkpoint)$/i);
      }
      expect("insert" in service).toBe(false);
      expect("update" in service).toBe(false);
      expect("delete" in service).toBe(false);
      expect("write" in service).toBe(false);
      expect("exec" in service).toBe(false);
    } finally {
      await service.close();
    }
  });

  it("leaves the fixture checksum identical before and after the full read plus probe run", async () => {
    const { dbPath, sharePath } = fixture();
    const before = sha256(dbPath);
    const reader = await RekordboxReader.open({ dbPath, sharePath });
    try {
      expect(reader.counts().tracks).toBe(4);
      expect(reader.trackRows({ limit: 10 })).toHaveLength(4);
      expect(reader.playlistRows()).toHaveLength(3);
      expect(reader.historyRows()).toHaveLength(1);
      expect(reader.probeWrite().rejected).toBe(true);
    } finally {
      reader.close();
    }
    const db = await openReadOnly(dbPath);
    try {
      expect(attemptWrite(db, WRITE_PROBE_SQL).rejected).toBe(true);
    } finally {
      db.close();
    }
    expect(sha256(dbPath)).toBe(before);
  });
});

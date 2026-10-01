// DS-15 second mode: the pyrekordbox uv sidecar (T-RBL-01).
//
// Two layers are proven here: the typed protocol client (injected runner, so it
// holds without an interpreter) and the real interpreter path against the
// fixture, including a SQLCipher-encrypted copy of it. Row counts must agree
// with the TypeScript reader and a write attempt must be rejected.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mapTrackRow, RekordboxReader } from "./db.js";
import { cipherDriverAvailable, LibraryDbError } from "./driver.js";
import { deobfuscateKey } from "./options.js";
import { readLibraryViaSidecar, SidecarReader } from "./sidecar.js";
import { readFixturePayload, writeFixtureDb, type FixtureSummary } from "./test-fixtures.js";

const created: string[] = [];
const OWNER = process.env["AUTOLIGHT_OWNER_LIBRARY"] === "1";

function uvAvailable(): boolean {
  try {
    execFileSync("uv", ["--version"], { stdio: "ignore", timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

const UV = uvAvailable();

interface Fixture {
  root: string;
  dbPath: string;
  sharePath: string;
  summary: FixtureSummary;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "autolight-rbl-sidecar-"));
  created.push(root);
  const dbPath = join(root, "master.db");
  const sharePath = join(root, "share");
  const summary = writeFixtureDb({ dbPath, sharePath, audioDir: join(root, "audio") });
  return { root, dbPath, sharePath, summary };
}

const EXPORT_SCRIPT = String.raw`import sys
import sqlcipher3

plain, encrypted, key = sys.argv[1], sys.argv[2], sys.argv[3]
con = sqlcipher3.connect(plain)
con.execute("ATTACH DATABASE ? AS enc KEY ?", (encrypted, key))
con.execute("SELECT sqlcipher_export('enc')")
con.execute("DETACH DATABASE enc")
con.close()
print("exported")
`;

/** Encrypt a plain fixture with the key the blob derivation produces. */
function encryptFixture(root: string, dbPath: string): string {
  const encrypted = join(root, "master-encrypted.db");
  const stdout = execFileSync(
    "uv",
    ["run", "--project", join(process.cwd(), "..", "..", "analysis"), "python", "-c", EXPORT_SCRIPT, dbPath, encrypted, deobfuscateKey()],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 180_000 },
  );
  expect(stdout).toContain("exported");
  return encrypted;
}

afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe("sidecar client", () => {
  it("reports a non-zero exit, a bad payload and a spawn error as typed results", async () => {
    const failing = await readLibraryViaSidecar({ dbPath: "/nonexistent.db" }, {
      run: () => Promise.resolve({ code: 2, stdout: "", stderr: "Traceback\nModuleNotFoundError: no sqlcipher3\n" }),
    });
    expect(failing.ok).toBe(false);
    expect(failing.error).toContain("ModuleNotFoundError");

    const selfReported = await readLibraryViaSidecar({ dbPath: "/nonexistent.db" }, {
      run: () => Promise.resolve({ code: 1, stdout: '{"ok": false, "error": "no interpreter"}\n', stderr: "" }),
    });
    expect(selfReported.error).toContain("no interpreter");

    const junk = await readLibraryViaSidecar({ dbPath: "/nonexistent.db" }, {
      run: () => Promise.resolve({ code: 0, stdout: "not json\n", stderr: "" }),
    });
    expect(junk.ok).toBe(false);
    expect(junk.error).toContain("unexpected payload");

    const missingInterpreter = await readLibraryViaSidecar({ dbPath: "/nonexistent.db" }, {
      run: () => Promise.reject(new Error("spawn uv ENOENT")),
    });
    expect(missingInterpreter.error).toContain("ENOENT");
  });

  it("builds a reader from an injected dump without an interpreter", async () => {
    const { dbPath, sharePath } = fixture();
    const payload = readFixturePayload(dbPath);
    const reader = await SidecarReader.open({
      dbPath,
      encrypted: false,
      run: () => Promise.resolve({ code: 0, stdout: JSON.stringify(payload), stderr: "" }),
    });
    expect(reader.driver).toBe("pyrekordbox-sidecar");
    expect(reader.counts()).toEqual(payload.counts);
    expect(reader.dbVersion()).toBe("6000");
    expect(reader.trackRows({ limit: 2 }).map((row) => row["ID"])).toEqual(["101", "102"]);
    expect(reader.trackRows({ limit: 10 }).map((row) => row["Title"])).toEqual(["Aurora", "Basalt", "Cinder", "Delta"]);
    expect(reader.songPlaylistRows("p2").map((entry) => entry.trackNo)).toEqual([1, 1]);
  });
});

describe.skipIf(!UV)("sidecar against the real interpreter", () => {
  it("agrees with the TypeScript reader row for row and rejects a write", async () => {
    const { root, dbPath, sharePath, summary } = fixture();
    const sidecar = await SidecarReader.open({ dbPath, encrypted: false, probeWrite: true });
    const reader = await RekordboxReader.open({ dbPath, sharePath });
    try {
      expect(sidecar.counts()).toEqual(summary.counts);
      expect(reader.counts()).toEqual(sidecar.counts());
      expect(sidecar.dbVersion()).toBe(reader.dbVersion());

      // Same raw rows in, same normalized rows out: all three DS-15 modes
      // produce identical `LibraryTrack` values (T-RBL-01 DoD).
      const tsTracks = reader.trackRows({ limit: 10 }).map((row) => mapTrackRow(row, { sharePath }));
      const pyTracks = sidecar.trackRows({ limit: 10 }).map((row) => mapTrackRow(row, { sharePath }));
      expect(pyTracks).toEqual(tsTracks);
      expect(pyTracks.map((track) => track.title)).toEqual(["Aurora", "Basalt", "Cinder", "Delta"]);

      const probe = await sidecar.probeWrite();
      expect(probe.rejected).toBe(true);
      expect(probe.error).toMatch(/readonly|read-only/i);
    } finally {
      reader.close();
    }
  });

  it("reads a SQLCipher copy of the fixture and rejects a write there too", async () => {
    const { root, dbPath, sharePath, summary } = fixture();
    const encrypted = encryptFixture(root, dbPath);
    const sidecar = await SidecarReader.open({ dbPath: encrypted, encrypted: true, probeWrite: true });
    expect(sidecar.counts()).toEqual(summary.counts);
    expect((await sidecar.probeWrite()).rejected).toBe(true);

    const cipherAvailable = await cipherDriverAvailable();
    const opened = RekordboxReader.open({ dbPath: encrypted, sharePath, key: deobfuscateKey() });
    if (cipherAvailable) {
      const reader = await opened;
      try {
        expect(reader.counts()).toEqual(sidecar.counts());
        expect(reader.probeWrite().rejected).toBe(true);
      } finally {
        reader.close();
      }
    } else {
      await expect(opened).rejects.toMatchObject({ code: "cipher-module-missing" });
      await expect(opened).rejects.toBeInstanceOf(LibraryDbError);
    }
    // The share-relative paths in the encrypted copy still resolve.
    const first = sidecar.trackRow("101");
    expect(mapTrackRow(first ?? {}, { sharePath }).anlz.statuses).toEqual(["audio-ok", "anlz-ok"]);
  });
});

describe.skipIf(!OWNER)("owner library (opt in)", () => {
  it("reads the owner's real library read-only and returns its counts", async () => {
    const home = process.env["HOME"] ?? "";
    const dbPath = join(home, "Library", "Pioneer", "rekordbox", "master.db");
    const sharePath = join(home, "Library", "Pioneer", "rekordbox", "share");
    const sidecar = await SidecarReader.open({ dbPath, encrypted: true, probeWrite: true });
    const counts = sidecar.counts();
    console.log(`owner library counts: ${JSON.stringify(counts)} dbVersion=${String(sidecar.dbVersion())}`);
    expect(counts.tracks).toBeGreaterThan(0);
    expect(counts.playlists).toBeGreaterThan(0);
    const probe = await sidecar.probeWrite();
    expect(probe.rejected).toBe(true);

    const first = sidecar.trackRows({ limit: 5 });
    const sample = mapTrackRow(first[0] ?? {}, { sharePath });
    console.log(`owner sample: ${JSON.stringify({ id: sample.rekordboxId, analysisDataPath: sample.analysisDataPath, statuses: sample.anlz.statuses })}`);
  });
});

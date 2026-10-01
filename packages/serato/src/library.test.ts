// T-SER-04 proof: the fixture library the generator writes parses completely,
// crate order survives, an external-drive library merges, smart-crate rules
// evaluate while unknown records stay raw, the DS-35 watcher invalidates only
// the track that changed, and every read leaves the files untouched.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSeratoWatcher,
  defaultSeratoRoot,
  detectSeratoRoots,
  evaluateSmartCrate,
  mergeSeratoRows,
  readSeratoCrates,
  readSeratoDatabase,
  readSeratoSmartCrates,
  seratoWatchFiles,
} from "./library.js";
import { writeCrate, writeDatabaseV2, writeScrate } from "./test-fixtures.js";
import type { SeratoSmartCrate, SeratoTrackRow } from "./library.js";

const created: string[] = [];
const runningWatchers: { stop(): Promise<void> }[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

const TRACKS = [
  { filePath: "/music/house-a.mp3", title: "House A", artist: "DJ Test", album: "Fixture", genre: "House", bpm: 124, extraTags: [{ tag: "tcmt", text: "kept raw" }] },
  { filePath: "/music/house-b.mp3", title: "House B", artist: "DJ Test", album: "Fixture", genre: "House", bpm: 126 },
  { filePath: "/music/hiphop-c.mp3", title: "Hip Hop C", artist: "MC Test", album: "Fixture", genre: "Hip-Hop", bpm: 95 },
];

/** The generated fixture library the DoD names, written by the generator. */
function fixtureLibrary(): string {
  const root = join(tempDir("autolight-serato-lib-"), "_Serato_");
  mkdirSync(join(root, "Subcrates"), { recursive: true });
  mkdirSync(join(root, "SmartCrates"), { recursive: true });
  writeFileSync(join(root, "database V2"), writeDatabaseV2(TRACKS));
  writeFileSync(join(root, "Subcrates", "Evening.crate"), writeCrate(["/music/house-b.mp3", "/music/house-a.mp3"]));
  writeFileSync(join(root, "Subcrates", "Morning.crate"), writeCrate(["/music/hiphop-c.mp3"]));
  writeFileSync(join(root, "SmartCrates", "Smart House.scrate"), writeScrate({ name: "Smart House", trackPaths: [], textRule: "genre is House" }));
  writeFileSync(join(root, "SmartCrates", "Unknown Layout.scrate"), writeScrate({ name: "Unknown Layout", trackPaths: ["/music/house-a.mp3"] }));
  return root;
}

/** UTF-16BE bytes, the encoding the database stores text fields in. */
function utf16be(text: string): Buffer {
  const le = Buffer.from(text, "utf16le");
  const out = Buffer.alloc(le.length);
  for (let i = 0; i + 1 < le.length; i += 2) {
    out[i] = le[i + 1] as number;
    out[i + 1] = le[i] as number;
  }
  return out;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

afterEach(async () => {
  while (runningWatchers.length > 0) await (runningWatchers.pop() as { stop(): Promise<void> }).stop();
});

describe("serato library (T-SER-04)", () => {
  it("parses the generated database completely, with unmodelled fields retained raw", () => {
    const root = fixtureLibrary();
    const { rows, retainedTagCount } = readSeratoDatabase(root);
    expect(rows.map((row) => row.filePath)).toEqual(TRACKS.map((track) => track.filePath));
    expect(rows[0]).toMatchObject({ title: "House A", artist: "DJ Test", album: "Fixture", genre: "House", bpm: 124 });
    expect(rows[2]).toMatchObject({ title: "Hip Hop C", artist: "MC Test", genre: "Hip-Hop", bpm: 95 });
    expect(retainedTagCount).toBe(1);
    expect(Buffer.from(rows[0]?.rawTags.tcmt ?? "", "base64")).toEqual(utf16be("kept raw"));
  });

  it("keeps crate track order and reads every crate", () => {
    const root = fixtureLibrary();
    const crates = readSeratoCrates(root);
    expect(crates.map((crate) => crate.name)).toEqual(["Evening.crate", "Morning.crate"]);
    expect(crates[0]?.trackPaths).toEqual(["/music/house-b.mp3", "/music/house-a.mp3"]);
    expect(crates[1]?.trackPaths).toEqual(["/music/hiphop-c.mp3"]);
  });

  it("evaluates the rule records it understands and keeps unknown ones raw", () => {
    const root = fixtureLibrary();
    const { rows } = readSeratoDatabase(root);
    const crates = readSeratoSmartCrates(root);
    const known = crates.find((crate) => crate.name === "Smart House.scrate");
    expect(known?.rules).toEqual([{ tag: "rrul", field: "genre", operator: "is", value: "House", text: "genre is House" }]);
    const matched = evaluateSmartCrate(known as NonNullable<typeof known>, rows);
    expect(matched.matched.map((row) => row.title)).toEqual(["House A", "House B"]);
    expect(matched.unsupportedRules).toBe(1);

    const unknown = crates.find((crate) => crate.name === "Unknown Layout.scrate");
    expect(unknown?.rules).toHaveLength(0);
    expect(unknown?.unsupported.map((record) => record.tag)).toContain("runk");
    const unknownResult = evaluateSmartCrate(unknown as NonNullable<typeof unknown>, rows);
    expect(unknownResult.matched).toHaveLength(0);
    expect(unknownResult.unsupportedRules).toBeGreaterThan(0);
  });

  it("evaluates numeric comparisons against library rows", () => {
    const root = fixtureLibrary();
    const { rows } = readSeratoDatabase(root);
    writeFileSync(join(root, "SmartCrates", "Slow.scrate"), writeScrate({ name: "Slow", trackPaths: [], textRule: "bpm <= 124" }));
    const crate = readSeratoSmartCrates(root).find((entry) => entry.name === "Slow.scrate");
    const result = evaluateSmartCrate(crate as NonNullable<typeof crate>, rows);
    expect(result.matched.map((row) => row.title)).toEqual(["House A", "Hip Hop C"]);
  });

  it("discovers external-drive roots and merges their rows by path", () => {
    const home = tempDir("autolight-serato-home-");
    const volumes = tempDir("autolight-serato-volumes-");
    const internal = join(home, "Music", "_Serato_");
    mkdirSync(internal, { recursive: true });
    writeFileSync(join(internal, "database V2"), writeDatabaseV2([{ filePath: "/internal/one.mp3", title: "Internal" }]));
    const externalRoot = join(volumes, "DJSSD", "_Serato_");
    mkdirSync(externalRoot, { recursive: true });
    writeFileSync(join(externalRoot, "database V2"), writeDatabaseV2([{ filePath: "/external/two.mp3", title: "External" }]));

    const roots = detectSeratoRoots({ home, volumesDir: volumes });
    expect(roots.map((root) => root.path)).toEqual([defaultSeratoRoot(home), externalRoot]);
    expect(roots[0]?.external).toBe(false);
    expect(roots[1]?.external).toBe(true);
    const merged = mergeSeratoRows([
      readSeratoDatabase(internal).rows,
      readSeratoDatabase(externalRoot).rows,
    ]);
    expect(merged.map((row) => row.title)).toEqual(["Internal", "External"]);
    const deduped = mergeSeratoRows([
      readSeratoDatabase(internal).rows,
      readSeratoDatabase(internal).rows,
    ]);
    expect(deduped).toHaveLength(1);
  });

  it("honours library.serato.root when configured", () => {
    const configured = fixtureLibrary();
    const other = tempDir("autolight-serato-other-");
    const roots = detectSeratoRoots({ configured, home: other });
    expect(roots[0]?.path).toBe(configured);
    expect(roots[0]?.readable).toBe(true);
    expect(detectSeratoRoots({ configured, home: other })[0]?.external).toBe(false);
  });

  it("watches the database, crates and per-track audio with selective invalidation", async () => {
    const root = fixtureLibrary();
    const { rows } = readSeratoDatabase(root);
    const audioA = join(root, "house-a.mp3");
    const audioB = join(root, "house-b.mp3");
    writeFileSync(audioA, "a");
    writeFileSync(audioB, "b");
    const localRows: SeratoTrackRow[] = [
      { ...(rows[0] as SeratoTrackRow), filePath: audioA },
      { ...(rows[1] as SeratoTrackRow), filePath: audioB },
    ];
    const watched = seratoWatchFiles(root, localRows);
    expect(watched.some((file) => file.path === join(root, "database V2") && file.kind === "db")).toBe(true);
    expect(watched.filter((file) => file.kind === "audio").map((file) => file.trackId)).toEqual([audioA, audioB]);

    const watcher = createSeratoWatcher(root, localRows, { engine: "polling", pollMs: 60_000 });
    const changes: string[][] = [];
    watcher.on((change) => changes.push(change.invalidated));
    await watcher.start();
    runningWatchers.push(watcher);

    expect(watcher.sweep()).toBeUndefined();
    writeFileSync(audioA, "changed");
    const audioChange = watcher.sweep();
    expect(audioChange?.files.map((file) => file.path)).toEqual([audioA]);
    expect(audioChange?.invalidated).toContain("audio-derived");
    expect(audioChange?.invalidated).toContain("plan");

    writeFileSync(join(root, "database V2"), writeDatabaseV2([{ filePath: "/music/new.mp3", title: "New" }]));
    const dbChange = watcher.sweep();
    expect(dbChange?.files.map((file) => file.path)).toEqual([join(root, "database V2")]);
    expect(dbChange?.invalidated).toEqual(["row"]);
  });

  it("never writes to the library it reads", () => {
    const root = fixtureLibrary();
    const dbPath = join(root, "database V2");
    const cratePath = join(root, "Subcrates", "Evening.crate");
    const scratePath = join(root, "SmartCrates", "Smart House.scrate");
    const before = [sha256(dbPath), sha256(cratePath), sha256(scratePath)];
    const { rows } = readSeratoDatabase(root);
    readSeratoCrates(root);
    readSeratoSmartCrates(root);
    evaluateSmartCrate(readSeratoSmartCrates(root)[0] as SeratoSmartCrate, rows);
    expect([sha256(dbPath), sha256(cratePath), sha256(scratePath)]).toEqual(before);
  });
});

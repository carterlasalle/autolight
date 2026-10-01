// T-RBL-02 (F-RBL-08): ANLZ path resolution from a database row to the DAT,
// EXT and 2EX siblings, with typed statuses instead of exceptions.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAnlzSet, type StatFile } from "./anlz.js";

const created: string[] = [];

function tempShare(): string {
  const root = mkdtempSync(join(tmpdir(), "autolight-rbl-anlz-"));
  created.push(root);
  mkdirSync(join(root, "PIONEER", "USBANLZ", "7", "7a"), { recursive: true });
  return root;
}

afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe("anlz resolution", () => {
  it("resolves the stored share-relative path and its siblings", () => {
    const share = tempShare();
    const dir = join(share, "PIONEER", "USBANLZ", "7", "7a");
    writeFileSync(join(dir, "ANLZ0000.DAT"), "dat");
    writeFileSync(join(dir, "ANLZ0000.EXT"), "ext-bytes");
    writeFileSync(join(dir, "ANLZ0000.2EX"), "ex2");
    const audio = join(share, "track.mp3");
    writeFileSync(audio, "audio");

    const resolved = resolveAnlzSet(
      { analysisDataPath: "/PIONEER/USBANLZ/7/7a/ANLZ0000.DAT" },
      { sharePath: share, audioPath: audio },
    );
    expect(resolved.statuses).toEqual(["audio-ok", "anlz-ok"]);
    expect(resolved.anlzDir).toBe(dir);
    expect(resolved.dat?.path).toBe(join(dir, "ANLZ0000.DAT"));
    expect(resolved.dat?.sizeBytes).toBe(3);
    expect(resolved.ext?.sizeBytes).toBe(9);
    expect(resolved.ex2?.exists).toBe(true);
    expect(resolved.dat?.mtimeMs).toBeGreaterThan(0);
  });

  it("derives siblings from the row's own file name, not a constant", () => {
    const share = tempShare();
    const dir = join(share, "PIONEER", "USBANLZ", "9", "9b");
    mkdirSync(dir, { recursive: true });
    for (const suffix of [".DAT", ".EXT", ".2EX"]) writeFileSync(join(dir, `ANLZ0042${suffix}`), suffix);
    const resolved = resolveAnlzSet({ analysisDataPath: "PIONEER/USBANLZ/9/9b/ANLZ0042.DAT" }, { sharePath: share });
    expect(resolved.statuses).toEqual(["anlz-ok"]);
    expect(resolved.ext?.path).toBe(join(dir, "ANLZ0042.EXT"));
    expect(resolved.ex2?.path).toBe(join(dir, "ANLZ0042.2EX"));
  });

  it("reports partial and missing sets as statuses", () => {
    const share = tempShare();
    const dir = join(share, "PIONEER", "USBANLZ", "7", "7a");
    writeFileSync(join(dir, "ANLZ0000.DAT"), "dat");
    const partial = resolveAnlzSet({ analysisDataPath: "/PIONEER/USBANLZ/7/7a/ANLZ0000.DAT" }, { sharePath: share });
    expect(partial.statuses).toEqual(["anlz-partial"]);
    expect(partial.ext?.exists).toBe(false);

    const missing = resolveAnlzSet({ analysisDataPath: "/PIONEER/USBANLZ/9/9z/ANLZ0000.DAT" }, { sharePath: share });
    expect(missing.statuses).toEqual(["anlz-missing"]);
    expect(missing.anlzDir).toBe(join(share, "PIONEER", "USBANLZ", "9", "9z"));
  });

  it("treats an empty analysis path and a missing audio file as statuses", () => {
    const share = tempShare();
    const gone = resolveAnlzSet({ analysisDataPath: null }, { sharePath: share, audioPath: join(share, "gone.mp3") });
    expect(gone.statuses).toEqual(["audio-missing", "anlz-missing"]);
    expect(gone.anlzDir).toBeNull();
    expect(gone.dat).toBeNull();

    const blank = resolveAnlzSet({ analysisDataPath: "" }, { sharePath: share });
    expect(blank.statuses).toEqual(["anlz-missing"]);
  });

  it("accepts a stored absolute path when that file exists", () => {
    const share = tempShare();
    const outside = mkdtempSync(join(tmpdir(), "autolight-rbl-anlz-abs-"));
    created.push(outside);
    for (const suffix of [".DAT", ".EXT", ".2EX"]) writeFileSync(join(outside, `ANLZ0000${suffix}`), suffix);
    const resolved = resolveAnlzSet({ analysisDataPath: join(outside, "ANLZ0000.DAT") }, { sharePath: share });
    expect(resolved.statuses).toEqual(["anlz-ok"]);
    expect(resolved.anlzDir).toBe(outside);
  });

  it("keeps the displayed paths stable when a stat seam is injected", () => {
    const share = "/virtual/share";
    const stat: StatFile = (path) => (path.endsWith(".DAT") ? { sizeBytes: 10, mtimeMs: 5 } : undefined);
    const resolved = resolveAnlzSet(
      { analysisDataPath: "/PIONEER/USBANLZ/1/1/ANLZ0000.DAT" },
      { sharePath: share, statFile: stat, audioPath: "/virtual/share/a.mp3" },
    );
    expect(resolved.dat?.path).toBe(join(share, "PIONEER", "USBANLZ", "1", "1", "ANLZ0000.DAT"));
    expect(resolved.statuses).toEqual(["audio-missing", "anlz-partial"]);
  });
});

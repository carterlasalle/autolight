import { describe, expect, it } from "vitest";
import { anlzPaths, rowToIdentity, toNativeBeat, highPhraseLabel, phraseLabel, normalizeSection } from "./index.js";

describe("rekordbox-library", () => {
  it("resolves ANLZ siblings", () => {
    expect(anlzPaths("/m/ANLZ0000.DAT")).toEqual({ dat: "/m/ANLZ0000.DAT", ext: "/m/ANLZ0000.EXT", ex2: "/m/ANLZ0000.2EX" });
  });
  it("keeps native id + path", () => {
    expect(rowToIdentity({ rekordboxId: "42", filePath: "/m/t.mp3" }).canonicalPath).toBe("/m/t.mp3");
  });
  it("scales PQTZ seconds to ms, BPM as-is", () => {
    expect(toNativeBeat({ index: 0, beatInBar: 1, sourceTimeMs: 0.05, bpm: 142 }).sourceTimeMs).toBe(50);
  });
  it("rejects bad bar position", () => {
    expect(() => toNativeBeat({ index: 0, beatInBar: 5, sourceTimeMs: 0, bpm: 128 })).toThrow(RangeError);
  });
  it("expands high-mood variants", () => {
    expect(highPhraseLabel(2, 0, 0, 0)).toBe("Up 1");
    expect(highPhraseLabel(2, 0, 0, 1)).toBe("Up 2");
    expect(highPhraseLabel(2, 0, 1, 0)).toBe("Up 3");
    expect(phraseLabel(2, 8)).toBe("Bridge");
  });
  it("normalizes sections", () => {
    expect(normalizeSection("Up 1")).toBe("build");
    expect(normalizeSection("Verse 3")).toBe("verse");
  });
});

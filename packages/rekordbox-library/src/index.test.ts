import { describe, expect, it } from "vitest";
import { anlzPaths, rowToIdentity, toNativeBeat } from "./index.js";

describe("rekordbox-library", () => {
  it("resolves ANLZ siblings", () => {
    expect(anlzPaths("/m/ANLZ0000.DAT")).toEqual({ dat: "/m/ANLZ0000.DAT", ext: "/m/ANLZ0000.EXT", ex2: "/m/ANLZ0000.2EX" });
  });
  it("keeps native id + path", () => {
    expect(rowToIdentity({ rekordboxId: "42", filePath: "/m/t.mp3" }).canonicalPath).toBe("/m/t.mp3");
  });
  it("rejects bad bar position", () => {
    expect(() => toNativeBeat({ index: 0, beatInBar: 5, sourceTimeMs: 0, bpm: 128 })).toThrow(RangeError);
  });
});

import { describe, expect, it } from "vitest";
import { isSelectedTrack, libraryRowKey, libraryRowLabels, normalizeTrackId } from "./track-key.js";

describe("library TrackId keying (T-ID-03, F-ID-03)", () => {
  it("rejects empty ids instead of falling back to title", () => {
    expect(() => normalizeTrackId("")).toThrow();
    expect(libraryRowKey({ trackId: "t1", title: "Same" })).toBe("t1");
  });

  it("keeps the React key stable across a rename", () => {
    const before = { trackId: "t1", title: "Old Title" };
    const after = { trackId: "t1", title: "New Title" };
    expect(libraryRowKey(after)).toBe(libraryRowKey(before));
  });

  it("selects exactly one track when two rows share a title", () => {
    const a = { trackId: "track-aaa-1", title: "Same Title" };
    const b = { trackId: "track-bbb-2", title: "Same Title" };
    expect(isSelectedTrack(a, "track-aaa-1")).toBe(true);
    expect(isSelectedTrack(b, "track-aaa-1")).toBe(false);
    expect(isSelectedTrack(a, null)).toBe(false);
  });

  it("disambiguates same-title labels while unique titles render unchanged", () => {
    const labels = libraryRowLabels([
      { trackId: "track-aaa-1", title: "Same Title", artist: "A" },
      { trackId: "track-bbb-2", title: "Same Title", artist: "B" },
      { trackId: "t3", title: "Only One" },
    ]);
    expect(labels.get("t3")).toBe("Only One");
    expect(labels.get("track-aaa-1")).not.toBe(labels.get("track-bbb-2"));
  });
});

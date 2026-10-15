import { describe, expect, it } from "vitest";
import { normalizeTrackId, TrackStateMap, uniqueTrackLabels } from "./keys.js";
import { Store } from "./index.js";

describe("TrackId keying (T-ID-03, F-ID-03)", () => {
  it("rejects empty ids instead of falling back to title", () => {
    // The message names the offending input, so the empty string and the
    // whitespace-only id are distinct failures (batch-49).
    expect(() => normalizeTrackId("")).toThrow(/track-key: empty TrackId ""/);
    expect(() => normalizeTrackId("   ")).toThrow(/track-key: empty TrackId "   "/);
    expect(normalizeTrackId("  t1 ")).toBe("t1");
  });

  it("keeps per-track UI state across a rename (same TrackId, new title)", () => {
    const state = new TrackStateMap<{ scroll: number }>();
    state.set("t1", { scroll: 120 });
    // Rename changes the displayed title, never the TrackId: state survives.
    expect(state.get("t1")).toEqual({ scroll: 120 });
    state.retain(["t1", "t2"]);
    expect(state.get("t1")).toEqual({ scroll: 120 });
    state.retain(["t2"]);
    expect(state.has("t1")).toBe(false);
  });

  it("shows two same-title tracks as distinct rows with distinct keys", () => {
    const labels = uniqueTrackLabels([
      { trackId: "track-aaa-1", title: "Same Title", artist: "A" },
      { trackId: "track-bbb-2", title: "Same Title", artist: "B" },
    ]);

    expect(labels.size).toBe(2);
    // The disambiguation is the artist plus an id prefix: exact labels, not
    // just "contains the title and differs" (batch-49). The ids first differ
    // at the eighth character, so the minimal prefix is eight.
    expect(labels.get("track-aaa-1")).toBe("Same Title - A (track-aa)");
    expect(labels.get("track-bbb-2")).toBe("Same Title - B (track-bb)");
  });

  it("keeps one label clean when the title is unique", () => {
    const labels = uniqueTrackLabels([{ trackId: "t1", title: "Only One" }]);
    expect(labels.get("t1")).toBe("Only One");
  });
  it("extends the id prefix when 8 chars collide", () => {
    const labels = uniqueTrackLabels([
      { trackId: "abcdefgh1111", title: "Same", artist: "A" },
      { trackId: "abcdefgh2222", title: "Same", artist: "B" },
    ]);
    const [a, b] = [labels.get("abcdefgh1111"), labels.get("abcdefgh2222")];
    expect(a).toContain("A");
    expect(b).toContain("B");
    expect(a).not.toBe(b);
    expect(a).toContain("abcdefgh1");
    expect(b).toContain("abcdefgh2");
  });
  it("keeps the first row when a trackId repeats", () => {
    const labels = uniqueTrackLabels([
      { trackId: "t1", title: "One" },
      { trackId: "t1", title: "Other" },
    ]);
    expect(labels.get("t1")).toBe("One");
  });
  it("keeps a stored undefined value without recreating it", () => {
    const state = new TrackStateMap<undefined>();
    let calls = 0;
    state.set("t1", undefined);
    const got = state.getOrCreate("t1", () => { calls += 1; return undefined; });
    expect(got).toBeUndefined();
    expect(calls).toBe(0);
  });
  it("prunes stale tracks even with a malformed library id", () => {
    const state = new TrackStateMap<number>();
    state.set("t1", 1);
    state.set("t2", 2);
    state.retain(["t1", "   "]);
    expect(state.has("t1")).toBe(true);
    expect(state.has("t2")).toBe(false);
  });

  it("serves each same-title track its own cached plan (cache keyed by TrackId)", () => {
    const store = new Store();

    try {
      store.saveTrack("track-aaa-1", JSON.stringify({ id: "track-aaa-1" }), 200);
      store.saveTrack("track-bbb-2", JSON.stringify({ id: "track-bbb-2" }), 210);
      store.saveShowPlan("track-aaa-1", "club", "p1", "seed-a", '{"trackId":"track-aaa-1"}', {
        sourceFingerprint: "fp-a",
      });
      store.saveShowPlan("track-bbb-2", "club", "p1", "seed-b", '{"trackId":"track-bbb-2"}', {
        sourceFingerprint: "fp-b",
      });
      // Exact values: the stored JSON embeds the track id, so a substring
      // assertion would only re-check the round-trip (batch-49).
      expect(store.loadShowPlan("track-aaa-1", "club", "p1")).toBe('{"trackId":"track-aaa-1"}');
      expect(store.loadShowPlan("track-bbb-2", "club", "p1")).toBe('{"trackId":"track-bbb-2"}');
      // The key dimensions are separate columns: seed and source fingerprint
      // must round-trip, not just ride inside the JSON.
      const row = store.planRow({
        trackId: "track-aaa-1",
        styleId: "club",
        plannerVersion: "p1",
        styleHash: "",
        venueClass: "",
        configHash: "",
        sourceFingerprint: "fp-a",
      });

      expect(row?.track_id).toBe("track-aaa-1");
      expect(row?.seed).toBe("seed-a");
      expect(row?.plan_json).toBe('{"trackId":"track-aaa-1"}');
      // The sibling plan is not reachable under the first track's key parts.
      expect(store.planRow({
        trackId: "track-aaa-1",
        styleId: "club",
        plannerVersion: "p1",
        styleHash: "",
        venueClass: "",
        configHash: "",
        sourceFingerprint: "fp-b",
      })).toBeUndefined();
    } finally {
      store.close();
    }
  });
});

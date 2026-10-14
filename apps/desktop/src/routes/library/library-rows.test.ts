import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { advanceQueue, dropFromQueue, libraryTrackRow, prioritiseQueue, queueEntry, upcomingForDecks } from "./library-rows.js";
import { trackModelSchema, type ShowCue, type TrackModel } from "@autolight/contracts";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "test-fixtures", "analysis");

// Schema-validated builder: drift in TrackModel fails here, not silently.
function loadTrack(id: string): TrackModel {
  return trackModelSchema.parse(JSON.parse(readFileSync(join(fixtureDir, `${id}.trackmodel.json`), "utf8")));
}

const track = loadTrack("live-deck1");

// A stored model below READY: same fixture, adaptive coverage, so the
// not-ready branch is exercised with the real schema shape.
function adaptive(): TrackModel {
  return { ...track, analysisCoverage: "adaptive" };
}

const base = { deepAnalysis: "pending", show: "none", lastModified: null as string | null };

describe("library rows and queue (T-UI-05, spec 95/139)", () => {
  it("grades every spec status without guessing", () => {
    expect(libraryTrackRow({ track, gridWarned: false, sourceMissing: false, analyzing: false, failed: null, ...base }).status).toBe("READY");
    expect(libraryTrackRow({ track: null, gridWarned: false, sourceMissing: false, analyzing: true, failed: null, ...base }).status).toBe("ANALYZING");
    // track:null with no analysis running, and a stored model that is not
    // ready with no analysis running, both surface NEEDS ANALYSIS.
    expect(libraryTrackRow({ track: null, gridWarned: false, sourceMissing: false, analyzing: false, failed: null, ...base }).status).toBe("NEEDS ANALYSIS");
    expect(libraryTrackRow({ track: adaptive(), gridWarned: false, sourceMissing: false, analyzing: false, failed: null, ...base }).status).toBe("NEEDS ANALYSIS");
    expect(libraryTrackRow({ track, gridWarned: true, sourceMissing: false, analyzing: false, failed: null, ...base }).status).toBe("GRID WARNING");
    expect(libraryTrackRow({ track, gridWarned: false, sourceMissing: true, analyzing: false, failed: null, ...base }).status).toBe("SOURCE MISSING");
    const failed = libraryTrackRow({ track, gridWarned: false, sourceMissing: false, analyzing: false, failed: "decode error", ...base });
    expect(failed.status).toBe("FAILED");
    expect(failed.failReason).toBe("decode error");
    // branch precedence: failed > !track > sourceMissing > gridWarned
    expect(libraryTrackRow({ track, gridWarned: true, sourceMissing: true, analyzing: true, failed: null, ...base }).status).toBe("SOURCE MISSING");
    expect(libraryTrackRow({ track, gridWarned: true, sourceMissing: true, analyzing: false, failed: "x", ...base }).status).toBe("FAILED");
  });
  it("reports ANALYZING for a re-analysis even when the stored model is ready", () => {
    // The stored model is READY, but a re-analysis is in flight: the row
    // must surface ANALYZING rather than masking it behind READY.
    expect(libraryTrackRow({ track, gridWarned: false, sourceMissing: false, analyzing: true, failed: null, ...base }).status).toBe("ANALYZING");
  });
  it("populates the key column from the track's musical key", () => {
    const keyed: TrackModel = { ...track, musicalKey: { key: "8A", mode: "minor", confidence: 0.8 } };
    expect(libraryTrackRow({ track: keyed, gridWarned: false, sourceMissing: false, analyzing: false, failed: null, ...base }).key).toBe("8A");
    expect(libraryTrackRow({ track, gridWarned: false, sourceMissing: false, analyzing: false, failed: null, ...base }).key).toBeNull();
  });
  it("runs the preanalysis queue through its states", () => {
    const before = [queueEntry("a"), queueEntry("b")];
    const snapshot = structuredClone(before);
    let q = advanceQueue(before, "a", "Analyzing", 0.5);
    // helpers are non-mutating and keep sibling entries intact
    expect(before).toEqual(snapshot);
    expect(q).toHaveLength(2);
    expect(q[0]).toMatchObject({ trackId: "a", state: "Analyzing", progress: 0.5 });
    expect(q[1]).toMatchObject({ trackId: "b", state: "Queued", progress: 0, failReason: null });
    const prioritised = prioritiseQueue(q, "b");
    expect(before).toEqual(snapshot);
    expect(prioritised[0]).toMatchObject({ trackId: "b", priority: true });
    expect(prioritised.map((e) => e.trackId)).toEqual(["b", "a"]);
    expect(prioritised[1]).toMatchObject({ trackId: "a", state: "Analyzing", progress: 0.5 });
    q = prioritised;
    // unknown ids leave the queue unchanged
    expect(prioritiseQueue(q, "zzz")).toEqual(q);
    expect(advanceQueue(q, "zzz", "Ready", 1).map((e) => e.trackId)).toEqual(["b", "a"]);
    expect(dropFromQueue(q, "zzz").map((e) => e.trackId)).toEqual(["b", "a"]);
    q = advanceQueue(q, "b", "Failed", 1, "worker died");
    expect(q.find((e) => e.trackId === "b")).toMatchObject({ state: "Failed", failReason: "worker died" });
    // the untouched sibling keeps its state/progress/failReason
    expect(q.find((e) => e.trackId === "a")).toMatchObject({ state: "Analyzing", progress: 0.5, failReason: null });
    q = dropFromQueue(q, "b");
    expect(q.map((e) => e.trackId)).toEqual(["a"]);
  });
  it("labels upcoming cues per deck with deck-local beats (P-93)", () => {
    const cues: ShowCue[] = [
      { type: "white-hit", startBeat: 40, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 100 },
    ];
    const active: ShowCue[] = [
      { type: "wash", startBeat: 38, durationBeats: 8, intensity: 0.5, target: "ALL", priority: 50 },
    ];

    const out = upcomingForDecks([
      { deckId: 1, beat: 32, cues },
      { deckId: 2, beat: 100, cues },
    ]);

    expect(out.find((r) => r.deckId === 1)?.label).toBe("in 8 beats");
    expect(out.find((r) => r.deckId === 2)).toBeUndefined();

    // boundary: cue already started but still active reads "now"
    const nowOut = upcomingForDecks([{ deckId: 1, beat: 40, cues: active }]);
    expect(nowOut[0]?.label).toBe("now");
    // exact boundary startBeat === beat reads "now"
    const exact = upcomingForDecks([{ deckId: 1, beat: 40, cues }]);
    expect(exact[0]?.label).toBe("now");
    // one beat out reads "in 1 beats"
    const near = upcomingForDecks([{ deckId: 1, beat: 39, cues }]);
    expect(near[0]?.label).toBe("in 1 beats");
    // limit slices the per-deck list
    const many: ShowCue[] = [40, 41, 42].map((startBeat) => ({ type: "white-hit", startBeat, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 100 }));
    expect(upcomingForDecks([{ deckId: 1, beat: 0, cues: many }], 2)).toHaveLength(2);
  });
});

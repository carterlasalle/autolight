import { describe, expect, it } from "vitest";
import { advanceQueue, dropFromQueue, libraryTrackRow, prioritiseQueue, queueEntry, upcomingForDecks } from "./library-rows.js";
import type { TrackModel } from "@autolight/contracts";

const track = {
  identity: { id: "t1", sourceIds: {}, title: "Track", artist: "Artist" },
  durationSeconds: 200,
  beatGrid: { beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
  sections: [{ kind: "chorus", startBeat: 0, endBeat: 32, confidence: 0.9 }],
  musicalEvents: [],
  analysisCoverage: "structured",
} as unknown as TrackModel;

const base = { deepAnalysis: "pending", show: "none", lastModified: null as string | null };

describe("library rows and queue (T-UI-05, spec 95/139)", () => {
  it("grades every spec status without guessing", () => {
    expect(libraryTrackRow({ track, gridWarned: false, sourceMissing: false, analyzing: false, failed: null, ...base }).status).toBe("READY");
    expect(libraryTrackRow({ track: null, gridWarned: false, sourceMissing: false, analyzing: true, failed: null, ...base }).status).toBe("ANALYZING");
    expect(libraryTrackRow({ track, gridWarned: true, sourceMissing: false, analyzing: false, failed: null, ...base }).status).toBe("GRID WARNING");
    expect(libraryTrackRow({ track, gridWarned: false, sourceMissing: true, analyzing: false, failed: null, ...base }).status).toBe("SOURCE MISSING");
    const failed = libraryTrackRow({ track, gridWarned: false, sourceMissing: false, analyzing: false, failed: "decode error", ...base });
    expect(failed.status).toBe("FAILED");
    expect(failed.failReason).toBe("decode error");
  });
  it("runs the preanalysis queue through its states", () => {
    let q = [queueEntry("a"), queueEntry("b")];
    q = advanceQueue(q, "a", "Analyzing", 0.5);
    expect(q[0]).toMatchObject({ state: "Analyzing", progress: 0.5 });
    q = prioritiseQueue(q, "b");
    expect(q[0]?.trackId).toBe("b");
    q = advanceQueue(q, "b", "Failed", 1, "worker died");
    expect(q.find((e) => e.trackId === "b")).toMatchObject({ state: "Failed", failReason: "worker died" });
    q = dropFromQueue(q, "b");
    expect(q.map((e) => e.trackId)).toEqual(["a"]);
  });
  it("labels upcoming cues per deck with deck-local beats (P-93)", () => {
    const cues = [
      { type: "white-hit", startBeat: 40, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 100 },
    ];
    const out = upcomingForDecks([
      { deckId: 1, beat: 32, cues: cues as never[] },
      { deckId: 2, beat: 100, cues: cues as never[] },
    ]);
    expect(out.find((r) => r.deckId === 1)?.label).toBe("in 8 beats");
    expect(out.find((r) => r.deckId === 2)).toBeUndefined();
  });
});

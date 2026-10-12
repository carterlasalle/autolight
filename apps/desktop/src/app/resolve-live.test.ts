import { describe, expect, it } from "vitest";
import { makeDeck, makeFixture } from "@autolight/simulator";
import { buildLive } from "./resolve-live.js";

// AL-FLOW-003: the live cursor's computed beat must reach the render sink.
// buildLive renders the override beat when given (cursor path) and falls
// back to the fetch-time snapshot otherwise (one-shot path).
const track = {
  schemaVersion: 2 as const,
  analyzerVersion: "t",
  identity: { id: "trk1", sourceIds: {} },
  durationSeconds: 400,
  beatGrid: {
    version: 1,
    beats: Array.from({ length: 300 }, (_, i) => ({
      index: i, beatInBar: ((i % 4) + 1) as 1 | 2 | 3 | 4, sourceTimeMs: i * 468, bpm: 128,
    })),
  },
  sections: [
    { kind: "verse" as const, startBeat: 0, endBeat: 64, confidence: 0.9 },
    { kind: "chorus" as const, startBeat: 64, endBeat: 128, confidence: 0.9 },
  ],
  musicalEvents: [],
  analysisCoverage: "full" as const,
  readinessLevel: "full" as const,
  analysisCoverage2: {
    level: "full" as const,
    inputs: { "source.audio": { status: "absent" as const } },
  },
  gridWarnings: [],
  beatFeatures: [],
  phrases: [],
};

const plan = {
  schemaVersion: 1 as const,
  plannerVersion: "t",
  trackId: "trk1",
  styleId: "house",
  seed: "seed1",
  cues: [
    { type: "section-look" as const, startBeat: 64, durationBeats: 32, intensity: 0.8, target: "PRIMARY" as const, priority: 10 },
  ],
};

describe("buildLive beat wiring (AL-FLOW-003)", () => {
  it("renders the computed cursor beat, not the stale snapshot", () => {
    const stale = makeDeck({ deckId: 1, playheadSeconds: 10 });

    const live = buildLive(
      [{ track: track as never, plan: plan as never, deckId: 1, state: stale }],
      [makeFixture("f", 2)],
      false,
      { a: 70, b: 1 },
    );

    expect(live?.beat).toBe(70);
    expect(live?.deckA.section).toBe("chorus");
  });

  it("falls back to snapshot beats on the one-shot path", () => {
    const snap = makeDeck({ deckId: 1, playheadSeconds: 10 });

    const live = buildLive(
      [{ track: track as never, plan: plan as never, deckId: 1, state: snap }],
      [makeFixture("f", 2)],
      false,
    );

    expect(live?.beat).toBe(10);
    expect(live?.deckA.section).toBe("verse");
  });
});

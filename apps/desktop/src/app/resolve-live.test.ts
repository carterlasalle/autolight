import { describe, expect, it } from "vitest";
import { makeDeck, makeFixture } from "@autolight/simulator";
import { buildLive, pendingStyleDue, phraseBoundaryAfter } from "./resolve-live.js";
import { liveStorePatch } from "./store.js";

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

// Named cursor argument: which field is the beat is part of the contract,
// not an opaque literal (batch-46).
const cursor = (a: number, b: number): { a: number; b: number } => ({ a, b });

describe("buildLive beat wiring (AL-FLOW-003)", () => {
  it("renders the computed cursor beat, not the stale snapshot", () => {
    const stale = makeDeck({ deckId: 1, playheadSeconds: 10 });

    const live = buildLive(
      [{ track: track as never, plan: plan as never, state: stale }],
      [makeFixture("f", 2)],
      false,
      cursor(70, 1),
    );

    expect(live?.beat).toBe(70);
    expect(live?.deckA.section).toBe("chorus");
  });

  it("converts the snapshot playhead through the grid on the one-shot path", () => {
    const snap = makeDeck({ deckId: 1, playheadSeconds: 10 });

    const live = buildLive(
      [{ track: track as never, plan: plan as never, state: snap }],
      [makeFixture("f", 2)],
      false,
    );

    // 10 s at 468 ms/beat is ~21.37 beats, never 10: the fallback must run
    // seconds through the grid instead of reading them as beats (batch-46).
    const expectedBeat = 10_000 / 468;

    expect(live?.beat).toBeCloseTo(expectedBeat, 6);
    expect(live?.deckA.section).toBe("verse");
  });

  it("keeps deck B on its own cursor beat", () => {
    const deckOne = makeDeck({ deckId: 1, playheadSeconds: 10 });
    const deckTwo = makeDeck({ deckId: 2, playheadSeconds: 50 });

    const live = buildLive(
      [
        { track: track as never, plan: plan as never, state: deckOne },
        { track: track as never, plan: plan as never, state: deckTwo },
      ],
      [makeFixture("f", 2)],
      false,
      cursor(70, 80),
    );

    expect(live?.beat).toBe(70);
    // Deck B's cursor beat drives its own section lookup (80 lands in the
    // chorus while deck A's 70 would not).
    expect(live?.deckB.section).toBe("chorus");
  });

  it("returns null with empty decks and reads section bounds half-open", () => {
    expect(buildLive([], [], false)).toBeNull();
    const deckOne = makeDeck({ deckId: 1, playheadSeconds: 10 });
    const entry = { track: track as never, plan: plan as never, state: deckOne };

    // Exactly on the boundary the later section owns the beat...
    expect(buildLive([entry], [makeFixture("f", 2)], false, cursor(64, 1))?.deckA.section).toBe("chorus");
    // ...and past the last section no section matches.
    expect(buildLive([entry], [makeFixture("f", 2)], false, cursor(500, 1))?.deckA.section).toBeUndefined();
  });

  it("writes the built beat to the store sink", () => {
    const stale = makeDeck({ deckId: 1, playheadSeconds: 10 });
    const live = buildLive(
      [{ track: track as never, plan: plan as never, state: stale }],
      [makeFixture("f", 2)],
      false,
      cursor(70, 1),
    );

    expect(live).not.toBeNull();
    const patch = liveStorePatch(live!, 0.5);

    // The exact AL-FLOW-003 regression: the cursor beat must reach the sink.
    expect(patch.live).toBe(live);
    expect(patch.liveBeat).toBe(70);
    expect(patch.bpm).toBe(live!.bpm);
    expect(patch.reactiveLevel).toBeCloseTo(0.1, 9);
  });
});

describe("pending style handover", () => {
  it("arms the next phrase boundary and applies on the first crossing", () => {
    expect(phraseBoundaryAfter(70)).toBe(96);
    expect(phraseBoundaryAfter(96)).toBe(128);
    let decision = pendingStyleDue(70, null);

    expect(decision).toEqual({ due: false, next: 96 });
    decision = pendingStyleDue(95.5, decision.next);
    expect(decision.due).toBe(false);
    // The cursor advances fractionally, so the crossing must apply even when
    // the beat never lands exactly on the boundary.
    decision = pendingStyleDue(96.3, decision.next);
    expect(decision).toEqual({ due: true, next: null });
  });
});

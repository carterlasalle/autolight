import { describe, expect, it } from "vitest";
import type { TrackModel } from "@autolight/contracts";
import { liveViewModel } from "./live.js";
import { makeDeck, makeFixture } from "@autolight/simulator";

const cuesA = [
  { type: "section-look", startBeat: 0, durationBeats: 32, intensity: 0.8, target: "PRIMARY", priority: 10 },
  { type: "white-hit", startBeat: 32, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 100 },
];

const cuesB = [
  { type: "section-look", startBeat: 0, durationBeats: 32, intensity: 0.6, target: "SECONDARY", priority: 10 },
];

function deck(id: number, ch: number, xf: number, track: string | null) {
  return makeDeck({
    deckId: id, channelFader: ch, crossfader: xf,
    track: track ? { id: track, sourceIds: {} } : null,
    master: null,
  });
}

describe("live view-model", () => {
  it("blends decks and surfaces upcoming cues", () => {
    // Crossfader values differ per deck so the blend path is exercised:
    // wa = 1*1 = 1, wb = 0.2*0.5 = 0.1, owner is a.
    const vm = liveViewModel({
      deckA: deck(1, 1, 1, "a"), deckB: deck(2, 0.2, 0.5, "b"),
      mixA: { state: deck(1, 1, 1, "a"), beat: 0, cues: cuesA, impactStrength: 0.5 },
      mixB: { state: deck(2, 0.2, 0.5, "b"), beat: 0, cues: cuesB, impactStrength: 0.9 },
      beatA: 0, beatB: 0,
      fixtures: [{ ...makeFixture("f", 4), groups: ["PRIMARY", "SECONDARY"] }],
      track: null, reactiveEnergy: 0.1, reactiveAmount: 0.15,
    });

    expect(vm.weights.a).toBeGreaterThan(vm.weights.b);
    expect(vm.weights).toEqual({ a: 1, b: 0.1 });
    expect(vm.owner).toBe("a");
    // The surviving cue is the white-hit at startBeat 32 for ALL.
    expect(vm.upcoming).toContainEqual(
      expect.objectContaining({ type: "white-hit", startBeat: 32, target: "ALL" }),
    );
    expect(vm.cells).toHaveLength(4);
    expect(vm.cells.map((c) => c.x)).toEqual([0, 1 / 3, 2 / 3, 1]);

    // Reactive overlay lifts the blended look above the raw plan color.
    const plain = liveViewModel({
      deckA: deck(1, 1, 1, "a"), deckB: deck(2, 0.2, 0.5, "b"),
      mixA: { state: deck(1, 1, 1, "a"), beat: 0, cues: cuesA, impactStrength: 0.5 },
      mixB: { state: deck(2, 0.2, 0.5, "b"), beat: 0, cues: cuesB, impactStrength: 0.9 },
      beatA: 0, beatB: 0,
      fixtures: [{ ...makeFixture("f", 4), groups: ["PRIMARY", "SECONDARY"] }],
      track: null, reactiveEnergy: 0, reactiveAmount: 0,
    });

    expect(vm.cells).not.toEqual(plain.cells);
    expect(vm.libraryStatus).toBe("NEEDS ANALYSIS");
  });
  it("stays dark when both decks silent", () => {
    const fixtures = [{ ...makeFixture("f", 2), groups: [] }];

    const vm = liveViewModel({
      deckA: deck(1, 0, 1, null), deckB: deck(2, 0, 1, null),
      mixA: { state: deck(1, 0, 1, null), beat: 0, cues: [], impactStrength: 0 },
      mixB: { state: deck(2, 0, 1, null), beat: 0, cues: [], impactStrength: 0 },
      beatA: 0, beatB: 0,
      fixtures,
      track: null, reactiveEnergy: 0, reactiveAmount: 0,
    });

    expect(vm.owner).toBeNull();
    // Two segments: the empty render can never be vacuous.
    expect(vm.cells).toHaveLength(2);
    expect(vm.cells.every((c) => c.color === "rgb(0,0,0)")).toBe(true);
  });
  it("reports READY status and a non-null owner for a real track", () => {
    // SAFETY: liveViewModel reads only identity/beatGrid/sections/coverage,
    // all present here; the narrowed fixture keeps the status path honest.
    const track = {
      identity: { id: "t1", sourceIds: {}, title: "Track", artist: "Artist" },
      durationSeconds: 200,
      beatGrid: { beats: [{ index: 0, beatInBar: 1, sourceTimeMs: 0, bpm: 128 }] },
      sections: [{ kind: "chorus", startBeat: 0, endBeat: 32, confidence: 0.9 }],
      musicalEvents: [],
      analysisCoverage: "structured",
    } as unknown as TrackModel;

    const vm = liveViewModel({
      deckA: deck(1, 1, 1, "a"), deckB: deck(2, 0.2, 0.5, "b"),
      mixA: { state: deck(1, 1, 1, "a"), beat: 0, cues: cuesA, impactStrength: 0.5 },
      mixB: { state: deck(2, 0.2, 0.5, "b"), beat: 0, cues: cuesB, impactStrength: 0.9 },
      beatA: 0, beatB: 0,
      fixtures: [{ ...makeFixture("f", 4), groups: ["PRIMARY", "SECONDARY"] }],
      track, reactiveEnergy: 0.1, reactiveAmount: 0.15,
    });

    expect(vm.libraryStatus).toBe("READY");
    expect(vm.owner).not.toBeNull();
  });
});

import { describe, expect, it } from "vitest";
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
  });
}

describe("live view-model", () => {
  it("blends decks and surfaces upcoming cues", () => {
    const vm = liveViewModel({
      deckA: deck(1, 1, 1, "a"), deckB: deck(2, 0.2, 1, "b"),
      mixA: { state: deck(1, 1, 1, "a"), beat: 0, cues: cuesA, impactStrength: 0.5 },
      mixB: { state: deck(2, 0.2, 1, "b"), beat: 0, cues: cuesB, impactStrength: 0.9 },
      beatA: 0, beatB: 0,
      fixtures: [{ ...makeFixture("f", 4), groups: ["PRIMARY", "SECONDARY"] }],
      track: null, reactiveEnergy: 0.1, reactiveAmount: 0.15,
    });
    expect(vm.weights.a).toBeGreaterThan(vm.weights.b);
    expect(vm.upcoming.length).toBeGreaterThan(0);
    expect(vm.cells).toHaveLength(4);
    expect(vm.libraryStatus).toBe("NEEDS ANALYSIS");
  });
  it("stays dark when both decks silent", () => {
    const vm = liveViewModel({
      deckA: deck(1, 0, 1, null), deckB: deck(2, 0, 1, null),
      mixA: { state: deck(1, 0, 1, null), beat: 0, cues: [], impactStrength: 0 },
      mixB: { state: deck(2, 0, 1, null), beat: 0, cues: [], impactStrength: 0 },
      beatA: 0, beatB: 0,
      fixtures: [{ ...makeFixture("f", 2), groups: [] }],
      track: null, reactiveEnergy: 0, reactiveAmount: 0,
    });
    expect(vm.owner).toBeNull();
    expect(vm.cells.every((c) => c.color === "rgb(0,0,0)")).toBe(true);
  });
});

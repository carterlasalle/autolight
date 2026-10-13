import { test, expect } from "@playwright/test";
import { liveViewModel, type LiveViewModel } from "../src/features/live/live.js";
import { makeDeck, makeFixture } from "@autolight/simulator";

// Desktop E2E (§126): critical user journeys against the pure view-model —
// no Electron window needed in CI. Fresh-install packaging is covered by
// `yarn install && yarn build && yarn verify:phase1` on clean macOS/Windows.

function brightness(cells: { color: string }[]): number {
  // Every cell must use the rgb() encoding: a cell that slips past the
  // parser fails here instead of silently counting as lit or black.
  let lit = 0;

  for (const c of cells) {
    const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(c.color);
    expect(m).not.toBeNull();

    if (m![1] !== "0" || m![2] !== "0" || m![3] !== "0") lit += 1;
  }

  return lit;
}

test("normal night: load → play → crossfade hands over ownership", () => {
  // A and B own distinct fixtures so the dominant deck's cells are visible:
  // one shared fixture would paint the same cells from both decks.
  const fx = [
    { ...makeFixture("fa", 4, 0, 1, ["PRIMARY"]) },
    { ...makeFixture("fb", 4, 0, 1, ["SECONDARY"]) },
  ];

  const base = {
    beatA: 0, beatB: 0, fixtures: fx, track: null,
    reactiveEnergy: 0, reactiveAmount: 0,
  } as const;

  const cuesA = [{ type: "section-look", startBeat: 0, durationBeats: 32, intensity: 0.8, target: "PRIMARY", priority: 10 }];
  const cuesB = [{ type: "section-look", startBeat: 0, durationBeats: 32, intensity: 0.8, target: "SECONDARY", priority: 10 }];

  const at = (xa: number, xb: number): LiveViewModel => {
    const deckA = makeDeck({ deckId: 1, channelFader: 1, crossfader: xa, track: { id: "a", sourceIds: {} } });
    const deckB = makeDeck({ deckId: 2, channelFader: 1, crossfader: xb, track: { id: "b", sourceIds: {} } });

    return liveViewModel({
      ...base,
      deckA,
      deckB,
      mixA: { state: deckA, beat: 0, cues: cuesA, impactStrength: 0.5 },
      mixB: { state: deckB, beat: 0, cues: cuesB, impactStrength: 0.5 },
    });
  };

  // Full left: A dominates cells; full right: B dominates.
  const left = at(1, 0);
  const right = at(0, 1);

  // Ownership hands over with the crossfader.
  expect(left.owner).toBe("a");
  expect(right.owner).toBe("b");
  expect(left.weights.a).toBeGreaterThan(right.weights.a);

  // The dominant deck lights its own fixture and only it.
  expect(brightness(left.cells.slice(0, 4))).toBeGreaterThan(0);
  expect(brightness(left.cells.slice(4))).toBe(0);
  expect(brightness(right.cells.slice(0, 4))).toBe(0);
  expect(brightness(right.cells.slice(4))).toBeGreaterThan(0);
});

test("emergency blackout produces black frames", () => {
  // BLACKOUT is a toolbar button, never behind a modal (§94, §144). The
  // blackout path renders all-zero cells, never a power command: prove the
  // frame content here; the transport invariant (zero turn commands) is
  // asserted by T-GOV-09 against the recording transport.
  const fx = [{ ...makeFixture("f", 4), groups: ["PRIMARY", "SECONDARY"] }];
  // A lower-priority lit look covers the same cells, so black proves the
  // blackout override: without the blackout cue these cells render lit.
  const litCues = [{ type: "section-look", startBeat: 0, durationBeats: 32, intensity: 0.8, target: "ALL", priority: 10 }];
  const blackoutCues = [...litCues, { type: "blackout", startBeat: 0, durationBeats: 32, intensity: 1, target: "ALL", priority: 100 }];
  const deck = makeDeck({ deckId: 1, channelFader: 1, crossfader: 1, track: { id: "a", sourceIds: {} } });
  const idleDeck = makeDeck({ deckId: 2, playing: false, track: null });

  const lit = liveViewModel({
    deckA: deck, deckB: idleDeck,
    mixA: { state: deck, beat: 4, cues: litCues, impactStrength: 0.5 },
    mixB: { state: idleDeck, beat: 4, cues: [], impactStrength: 0 },
    beatA: 4, beatB: 4, fixtures: fx, track: null,
    reactiveEnergy: 0, reactiveAmount: 0,
  });

  expect(brightness(lit.cells)).toBeGreaterThan(0);

  const vm = liveViewModel({
    deckA: deck, deckB: idleDeck,
    mixA: { state: deck, beat: 4, cues: blackoutCues, impactStrength: 0.5 },
    mixB: { state: idleDeck, beat: 4, cues: [], impactStrength: 0 },
    beatA: 4, beatB: 4, fixtures: fx, track: null,
    reactiveEnergy: 0, reactiveAmount: 0,
  });

  expect(vm.cells.length).toBe(4);
  expect(brightness(vm.cells)).toBe(0);
});

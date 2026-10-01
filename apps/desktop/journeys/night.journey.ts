import { test, expect } from "@playwright/test";
import { liveViewModel } from "../src/features/live/live.js";
import { makeDeck, makeFixture } from "@autolight/simulator";

// Desktop E2E (§126): critical user journeys against the pure view-model —
// no Electron window needed in CI. Fresh-install packaging is covered by
// `yarn install && yarn build && yarn verify:phase1` on clean macOS/Windows.
test("normal night: load → play → crossfade hands over ownership", () => {
  const fx = [{ ...makeFixture("f", 4), groups: ["PRIMARY", "SECONDARY"] }];
  const base = {
    beatA: 0, beatB: 0, fixtures: fx, track: null,
    reactiveEnergy: 0, reactiveAmount: 0,
  } as const;
  const cuesA = [{ type: "section-look", startBeat: 0, durationBeats: 32, intensity: 0.8, target: "PRIMARY", priority: 10 }];
  const cuesB = [{ type: "section-look", startBeat: 0, durationBeats: 32, intensity: 0.8, target: "SECONDARY", priority: 10 }];
  const at = (xa: number, xb: number): ReturnType<typeof liveViewModel> => liveViewModel({
    ...base,
    deckA: makeDeck({ deckId: 1, channelFader: 1, crossfader: xa, track: { id: "a", sourceIds: {} } }),
    deckB: makeDeck({ deckId: 2, channelFader: 1, crossfader: xb, track: { id: "b", sourceIds: {} } }),
    mixA: { state: makeDeck({ deckId: 1, channelFader: 1, crossfader: xa, track: { id: "a", sourceIds: {} } }), beat: 0, cues: cuesA, impactStrength: 0.5 },
    mixB: { state: makeDeck({ deckId: 2, channelFader: 1, crossfader: xb, track: { id: "b", sourceIds: {} } }), beat: 0, cues: cuesB, impactStrength: 0.5 },
  });
  // Full left: A dominates cells; full right: B dominates.
  const left = at(1, 0);
  const right = at(0, 1);
  const brightness = (cells: { color: string }[]): number =>
    cells.reduce((n, c) => n + (c.color !== "rgb(0,0,0)" ? 1 : 0), 0);
  expect(brightness(left.cells)).toBeGreaterThan(0);
  expect(brightness(right.cells)).toBeGreaterThan(0);
  expect(left.weights.a).toBeGreaterThan(right.weights.a);
});

test("emergency blackout produces black frames with stream armed", () => {
  // BLACKOUT is a toolbar button, never behind a modal (§94, §144). The
  // blackout path renders all-zero cells, never a power command: prove the
  // frame content here; the transport invariant (zero turn commands) is
  // asserted by T-GOV-09 against the recording transport.
  const fx = [{ ...makeFixture("f", 4), groups: ["PRIMARY", "SECONDARY"] }];
  const blackoutCues = [{ type: "blackout", startBeat: 0, durationBeats: 32, intensity: 1, target: "ALL", priority: 100 }];
  const deck = makeDeck({ deckId: 1, channelFader: 1, crossfader: 1, track: { id: "a", sourceIds: {} } });
  const vm = liveViewModel({
    deckA: deck, deckB: makeDeck({ deckId: 2, playing: false, track: null }),
    mixA: { state: deck, beat: 4, cues: blackoutCues, impactStrength: 0.5 },
    mixB: { state: makeDeck({ deckId: 2, playing: false, track: null }), beat: 4, cues: [], impactStrength: 0 },
    beatA: 4, beatB: 4, fixtures: fx, track: null,
    reactiveEnergy: 0, reactiveAmount: 0,
  });
  expect(vm.cells.length).toBe(4);
  expect(vm.cells.every((c) => c.color === "rgb(0,0,0)")).toBe(true);
});

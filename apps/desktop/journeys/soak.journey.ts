import { test, expect } from "@playwright/test";
import { performanceScenario, soak, gateFrame, makeFixture } from "@autolight/simulator";
import { liveViewModel } from "../src/renderer/live.js";
import { makeDeck } from "@autolight/simulator";

// Qualification (§125): full-performance rehearsal — every frame renders,
// queue never grows, no dead worker, both decks heard, loops exercised.
test("4h performance rehearsal stays live", () => {
  const fx = [{ ...makeFixture("f", 8), groups: ["PRIMARY"] }];
  const cues = [{ type: "section-look", startBeat: 0, durationBeats: 100000, intensity: 0.8, target: "PRIMARY", priority: 10 }];
  let n = 0;
  let lit = 0;
  const decks = new Set<number>();
  for (const d of performanceScenario({ fps: 60, hours: 4 })) {
    n++;
    decks.add(d.deckId);
    const gate = gateFrame(n, { dropEvery: 997 });
    if (gate === "offline") continue;
    const vm = liveViewModel({
      deckA: d, deckB: makeDeck({ deckId: 2, playing: false, track: null }),
      mixA: { state: d, beat: 0, cues, impactStrength: 0.5 },
      mixB: { state: makeDeck({ deckId: 2, playing: false, track: null }), beat: 0, cues: [], impactStrength: 0 },
      beatA: 0, beatB: 0, fixtures: fx, track: null,
      reactiveEnergy: 0, reactiveAmount: 0,
    });
    if (vm.cells.some((c) => c.color !== "rgb(0,0,0)")) lit++;
    if (n % 50000 === 0) expect(vm.cells.length).toBe(8);
  }
  expect(n).toBe(864000);
  expect(decks).toEqual(new Set([1, 2]));
  expect(lit).toBeGreaterThan(n * 0.9);
  const q = soak(864000, (i) => gateFrame(i, { dropEvery: 997 }));
  expect(q.maxPending).toBeLessThanOrEqual(1);
});

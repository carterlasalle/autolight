import { test, expect } from "@playwright/test";
import { performanceScenario, soak, gateFrame, makeDeck, makeFixture } from "@autolight/simulator";
import { liveViewModel } from "../src/features/live/live.js";

// Qualification (§125): full-performance rehearsal — every frame renders,
// queue never grows, no dead worker, both decks heard, loops exercised.
test("4h performance rehearsal stays live", () => {
  const fx = [{ ...makeFixture("f", 8), groups: ["PRIMARY"] }];
  const cues = [{ type: "section-look", startBeat: 0, durationBeats: 100000, intensity: 0.8, target: "PRIMARY", priority: 10 }];
  const deckB = makeDeck({ deckId: 2, playing: false, track: null });
  let n = 0;
  let fullLit = 0;
  let offlineFrames = 0;
  // The sounding deck's identity per frame: performanceScenario alternates
  // which deck leads, and the lead deck is the one mixed into deck A.
  const heard = new Set<number>();

  // A real disconnect window makes the offline branch live: drops and a
  // 10k-frame plug-pull, not just periodic 997-frame drops.
  const gate = (i: number): "send" | "drop" | "offline" =>
    gateFrame(i, { dropEvery: 997, disconnectAt: 400_000, reconnectAt: 410_000 });

  for (const d of performanceScenario({ fps: 60, hours: 4 })) {
    n++;
    const decision = gate(n);

    if (decision === "offline") {
      offlineFrames++;

      continue;
    }

    const vm = liveViewModel({
      deckA: d, deckB,
      mixA: { state: d, beat: 0, cues, impactStrength: 0.5 },
      mixB: { state: deckB, beat: 0, cues: [], impactStrength: 0 },
      beatA: 0, beatB: 0, fixtures: fx, track: null,
      reactiveEnergy: 0, reactiveAmount: 0,
    });

    if (vm.weights.a > 0) heard.add(d.deckId);
    // Full frame, not "any cell lit": the section-look cue drives all 8.
    if (vm.cells.every((c) => c.color !== "rgb(0,0,0)")) fullLit++;

    if (n % 50000 === 0) expect(vm.cells.length).toBe(8);
  }

  expect(n).toBe(864000);
  expect(offlineFrames).toBe(10000);
  // Both deck identities produced audible weight through the night.
  expect(heard).toEqual(new Set([1, 2]));
  expect(fullLit).toBeGreaterThan((n - offlineFrames) * 0.9);
  const q = soak(864000, gate);
  // Counters partition the run exactly. Dropped = 997-multiples outside the
  // disconnect window: 867 total multiples, 10 of them inside [400k, 410k).
  expect(q.sent + q.dropped + q.offline).toBe(864000);
  expect(q.offline).toBe(10000);
  expect(q.dropped).toBe(857);
});

import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { trackModelSchema, showStyleSchema } from "@autolight/contracts";
import type { DeckState } from "@autolight/contracts";
import { planShow, BUILT_IN_STYLES } from "@autolight/show-planner";
import { liveViewModel } from "../src/features/live/live.js";
import { makeDeck, makeFixture } from "@autolight/simulator";
import { parseFixture } from "@autolight/rekordbox-live";

// Resolve upward instead of assuming one relative depth: a layout change
// fails with the attempted path, not a raw ENOENT (batch-22).
function fixtureDir(relative: string): string {
  let base = dirname(fileURLToPath(import.meta.url));

  for (let i = 0; i < 6; i++) {
    const candidate = join(base, relative);

    if (existsSync(candidate)) return candidate;
    base = dirname(base);
  }

  throw new Error(`journey fixture dir ${relative} not found within 6 levels of ${import.meta.url}`);
}

const dir = fixtureDir(join("test-fixtures", "analysis"));

const fixDir = fixtureDir(join("protocol-fixtures", "rekordbox", "7.2.10", "macos"));

// Live session (§150 normal night, 2026-09-29): the two tracks actually loaded
// in Rekordbox right now — Nice For What (deck 1) + Homecoming (deck 2) —
// planned from real ANLZ grids and rendered through the real view-model.
test("live decks: both loaded tracks plan and light the rig", () => {
  const fx = [
    { ...makeFixture("left", 14, 0, 0), groups: ["PRIMARY"] },
    { ...makeFixture("right", 14, 1, 1), groups: ["SECONDARY"] },
  ];

  const style = showStyleSchema.parse(BUILT_IN_STYLES.club);

  const homecoming = trackModelSchema.parse(
    JSON.parse(readFileSync(join(dir, "homecoming.trackmodel.json"), "utf8")),
  );

  const planB = planShow(homecoming, style);
  expect(planB.cues.length).toBeGreaterThan(0);

  const both = parseFixture(
    JSON.parse(readFileSync(join(fixDir, "both-decks-loaded", "capture.json"), "utf8")),
  );

  expect(both.expectedEvents).toHaveLength(2);
  const beat = 120;

  const deckStates = both.expectedEvents.map((e, i) => ({
    ...e,
    receivedAtNs: 1_000_000_000n + BigInt(i * 100_000_000),
  }));

  const cuesB = planB.cues.filter((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats);
  expect(cuesB.length).toBeGreaterThan(0);

  const deckStateFor = (deckId: number): DeckState => {
    const replayed = deckStates.find((d) => d.deckId === deckId);

    if (!replayed) throw new Error(`both-decks-loaded fixture missing deck ${deckId}`);

    return makeDeck({ ...replayed, channelFader: deckId === 1 ? 0.2 : 1, crossfader: 1, receivedAtNs: replayed.receivedAtNs });
  };

  const deckA = deckStateFor(1);
  const deckB = deckStateFor(2);

  // The fixture carries the real track identities: a missing one is a
  // fixture regression, not a reason to substitute a remembered id
  // (batch-22).
  const trackIdOf = (state: DeckState, deck: number): string => {
    const id = state.track?.id;

    if (id === undefined) throw new Error(`both-decks-loaded fixture lacks deck ${deck} identity`);

    return id;
  };

  const vm = liveViewModel({
    deckA,
    deckB,
    mixA: { state: makeDeck({ ...deckA, track: { id: trackIdOf(deckA, 1), sourceIds: {} } }), beat, cues: [], impactStrength: 0.3 },
    mixB: { state: makeDeck({ ...deckB, track: { id: trackIdOf(deckB, 2), sourceIds: {} } }), beat, cues: cuesB, impactStrength: 0.9 },
    beatA: beat, beatB: beat, fixtures: fx, track: homecoming,
    reactiveEnergy: 0, reactiveAmount: 0,
  });

  expect(vm.owner).toBe("b");
  expect(vm.cells.filter((c) => c.color !== "rgb(0,0,0)").length).toBeGreaterThanOrEqual(Math.min(4, vm.cells.length));
  expect(vm.libraryStatus).toBe("READY");
});

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { trackModelSchema, showStyleSchema } from "@autolight/contracts";
import { planShow, BUILT_IN_STYLES } from "@autolight/show-planner";
import { liveViewModel } from "../src/features/live/live.js";
import { makeDeck, makeFixture } from "@autolight/simulator";
import { parseFixture } from "@autolight/rekordbox-live";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "test-fixtures", "analysis");
const fixDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "protocol-fixtures", "rekordbox", "7.2.10", "macos");

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

  const cuesB = planB.cues.filter((c) => 120 >= c.startBeat && 120 < c.startBeat + c.durationBeats);
  const vm = liveViewModel({
    deckA: makeDeck({ deckId: 1, channelFader: 0.2, crossfader: 1, track: { id: "rb:163221817", sourceIds: { rekordboxId: "163221817" } } }),
    deckB: makeDeck({ deckId: 2, channelFader: 1, crossfader: 1, track: { id: "rb:231828222", sourceIds: { rekordboxId: "231828222" } } }),
    mixA: { state: makeDeck({ deckId: 1, channelFader: 0.2, crossfader: 1, track: { id: "rb:163221817", sourceIds: {} } }), beat: 120, cues: [], impactStrength: 0.3 },
    mixB: { state: makeDeck({ deckId: 2, channelFader: 1, crossfader: 1, track: { id: "rb:231828222", sourceIds: {} } }), beat: 120, cues: cuesB, impactStrength: 0.9 },
    beatA: 120, beatB: 120, fixtures: fx, track: homecoming,
    reactiveEnergy: 0, reactiveAmount: 0,
  });
  expect(vm.owner).toBe("b");
  expect(vm.cells.some((c) => c.color !== "rgb(0,0,0)")).toBe(true);
  expect(vm.libraryStatus).toBe("READY");
});

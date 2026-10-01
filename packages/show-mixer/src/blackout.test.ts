import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { showStyleSchema, trackModelSchema, type ShowCue, type TrackIdentity, type TrackModel } from "@autolight/contracts";
import { BUILT_IN_STYLES, planShow } from "@autolight/show-planner";
import { makeDeck } from "@autolight/simulator";
import { blackoutDecision, mixDown, type BlackoutPolicy, type DeckMix, type MixResult } from "./index.js";

// P-66-translate-all: a planner-produced `ALL` blackout while the other deck
// is audible above `mixer.blackout.otherDeckThreshold` is translated per DS-18.
// The old SIDE target test is deleted with the SIDE target itself.

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "test-fixtures", "analysis");
const trackA = { id: "a", sourceIds: {} } satisfies TrackIdentity;
const trackB = { id: "b", sourceIds: {} } satisfies TrackIdentity;

// The real planner produces the blackout: a fake drop holds darkness (spec 25).
function plannerBlackout(): ShowCue {
  const model = trackModelSchema.parse(JSON.parse(readFileSync(join(dir, "real-track-1.trackmodel.json"), "utf8"))) as TrackModel;
  const withFakeDrop: TrackModel = {
    ...model,
    musicalEvents: [...model.musicalEvents, { type: "fake-drop", beat: 256, endBeat: 258, confidence: 1 }],
  };
  const plan = planShow(withFakeDrop, showStyleSchema.parse(BUILT_IN_STYLES.club));
  const blackout = plan.cues.find((c) => c.type === "blackout");
  if (blackout === undefined) throw new Error("planner did not program the fake-drop blackout");
  expect(blackout.target).toBe("ALL");
  return blackout;
}

const blackoutCue = plannerBlackout();

function mixWith(otherWeight: number, policy: BlackoutPolicy, structural = false): MixResult {
  const buildCue: ShowCue = { type: "build-ramp", startBeat: blackoutCue.startBeat, durationBeats: 8, intensity: 0.6, target: "ALL", priority: 50 };
  const a: DeckMix = {
    state: makeDeck({ deckId: 1, channelFader: 1, crossfader: 1, master: false, track: trackA }),
    beat: blackoutCue.startBeat + 0.5,
    impactStrength: 1,
    cues: structural ? [blackoutCue, buildCue] : [blackoutCue],
  };
  const b: DeckMix = {
    state: makeDeck({ deckId: 2, channelFader: otherWeight, crossfader: 1, master: false, track: trackB }),
    beat: blackoutCue.startBeat + 0.5,
    impactStrength: 0.5,
    cues: structural ? [buildCue] : [],
  };
  return mixDown(a, b, { blackoutPolicy: policy });
}

function blackoutOut(result: MixResult): ShowCue {
  const kept = result.cues.find((c) => c.type === "blackout" || c.type === "dip");
  if (kept === undefined) throw new Error(`blackout was dropped: ${result.dropped.map((d) => d.reason).join("; ")}`);
  return kept;
}

describe("transition-aware blackout translation (P-66)", () => {
  it("uses a planner-produced ALL blackout as the test input", () => {
    expect(blackoutCue.type).toBe("blackout");
    expect(blackoutCue.target).toBe("ALL");
    expect(blackoutCue.durationBeats).toBeGreaterThan(0);
  });

  it("gives every DS-18 mode a behaviour", () => {
    const full = blackoutOut(mixWith(0.8, "full"));
    expect(full).toMatchObject({ type: "blackout", target: "ALL" });

    const spatial = blackoutOut(mixWith(0.8, "deck-spatial-dip"));
    expect(spatial).toMatchObject({ type: "dip", target: "LEFT", intensity: 0.25 });

    const side = blackoutOut(mixWith(0.8, "deck-side-blackout"));
    expect(side).toMatchObject({ type: "blackout", target: "LEFT" });

    const global = blackoutOut(mixWith(0.8, "global-partial-dip"));
    expect(global).toMatchObject({ type: "dip", target: "ALL", intensity: 0.25 });

    // The old SIDE target no longer exists anywhere in the translation.
    for (const mode of ["full", "deck-spatial-dip", "deck-side-blackout", "global-partial-dip"] as BlackoutPolicy[]) {
      expect(blackoutOut(mixWith(0.8, mode)).target).not.toBe("SIDE");
    }
  });

  it("keeps auto full only when both tracks structurally support it", () => {
    expect(blackoutOut(mixWith(0.8, "auto", true))).toMatchObject({ type: "blackout", target: "ALL" });
    expect(blackoutOut(mixWith(0.8, "auto", false))).toMatchObject({ type: "blackout", target: "LEFT" });
  });

  it("scales the auto translation with the other deck's weight", () => {
    expect(blackoutOut(mixWith(0.8, "auto"))).toMatchObject({ type: "blackout", target: "LEFT" });
    expect(blackoutOut(mixWith(0.6, "auto"))).toMatchObject({ type: "dip", target: "ALL" });
    expect(blackoutOut(mixWith(0.4, "auto"))).toMatchObject({ type: "dip", target: "LEFT" });
  });

  it("leaves the blackout alone below mixer.blackout.otherDeckThreshold", () => {
    const result = mixWith(0.1, "auto");
    expect(blackoutOut(result)).toMatchObject({ type: "blackout", target: "ALL" });
    const decision = blackoutDecision(blackoutCue, { policy: "auto", otherWeight: 0.1, side: "a" });
    expect(decision.translated).toBe(false);
    expect(decision.reason).toMatch(/otherDeckThreshold/);
    // Deck B's side is a different room half.
    expect(blackoutDecision(blackoutCue, { policy: "deck-side-blackout", otherWeight: 0.8, side: "b" }).cue.target).toBe("RIGHT");
  });

  it("records the translation reason for diagnostics", () => {
    const result = mixWith(0.8, "auto");
    expect(result.dropped).toEqual([]);
    const decision = blackoutDecision(blackoutCue, { policy: "auto", otherWeight: 0.8, side: "a" });
    expect(decision.translated).toBe(true);
    expect(decision.policy).toBe("deck-side-blackout");
    expect(decision.reason).toContain("0.80");
  });
});

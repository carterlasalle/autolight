import { describe, expect, it } from "vitest";
import { makeDeck, makeFixture } from "@autolight/simulator";
import type { Fixture, ShowCue, ShowPlan, TrackIdentity } from "@autolight/contracts";
import { frameHash, renderFrame } from "@autolight/renderer";
import { introductionStage, mixDown, type DeckMix, type LayerTag } from "./index.js";

// P-67-introduction: frame-sampled across a fader ramp, the incoming deck's
// palette and secondary spatial layer enter first, then its rhythm layers,
// then its exclusive impacts, decided by layer tag (spec 67).

const trackA = { id: "a", sourceIds: {} } satisfies TrackIdentity;
const trackB = { id: "b", sourceIds: {} } satisfies TrackIdentity;

const BEAT = 64;
const fixtures: Fixture[] = [makeFixture("f1", 6, 0, 1, ["PRIMARY", "SECONDARY"])];

const cue = (over: Partial<ShowCue> & Pick<ShowCue, "type">): ShowCue => ({
  startBeat: BEAT,
  durationBeats: 16,
  intensity: 0.9,
  target: "PRIMARY",
  priority: 10,
  ...over,
});

const incomingCues: ShowCue[] = [
  cue({ type: "section-look", target: "PRIMARY", priority: 10 }), // base
  cue({ type: "chase-flip", target: "SECONDARY", durationBeats: 8, priority: 11 }), // spatial
  cue({ type: "build-ramp", target: "ALL", durationBeats: 8, priority: 50 }), // accents
  cue({ type: "white-hit", target: "ALL", durationBeats: 0.25, intensity: 1, priority: 100 }), // exclusive
];

function atWeight(weight: number): { layers: LayerTag[]; cues: ShowCue[]; hash: string } {
  const incoming: DeckMix = {
    state: makeDeck({ deckId: 2, channelFader: weight, crossfader: 1, master: false, track: trackB }),
    beat: BEAT,
    impactStrength: 0.5,
    cues: incomingCues,
  };
  const outgoing: DeckMix = {
    state: makeDeck({ deckId: 1, channelFader: 1, crossfader: 1, master: false, track: trackA }),
    beat: BEAT,
    impactStrength: 0.4,
    cues: [cue({ type: "section-look", target: "PRIMARY", priority: 12 })],
  };
  const mixed = mixDown(incoming, outgoing);
  const plan: ShowPlan = { schemaVersion: 1, plannerVersion: "x", trackId: "t", styleId: "s", seed: "a", cues: mixed.cues };
  return {
    // The incoming deck is the first mix argument, so its layers carry side "a".
    layers: mixed.layers.filter((l) => l.side === "a").map((l) => l.tag),
    cues: mixed.cues,
    hash: frameHash(renderFrame(plan, BEAT + 0.5, fixtures)),
  };
}

describe("incoming deck introduction (P-67)", () => {
  it("admits palette, then rhythm, then impacts in order across a fader ramp", () => {
    const stages = [0.02, 0.1, 0.5, 0.9].map((w) => ({ weight: w, ...atWeight(w) }));
    expect(introductionStage(0.02)).toBe("silent");
    expect(introductionStage(0.1)).toBe("palette");
    expect(introductionStage(0.5)).toBe("rhythm");
    expect(introductionStage(0.9)).toBe("impacts");
    // Layer tags, not cue priorities, decide what enters.
    expect(stages[0]!.layers).toEqual([]);
    expect(stages[1]!.layers).toEqual(["base", "spatial"]);
    expect(stages[2]!.layers).toEqual(["base", "spatial", "accents"]);
    expect(stages[3]!.layers).toEqual(["base", "spatial", "accents", "exclusive"]);
  });

  it("samples a distinct frame at every stage", () => {
    const hashes = [0.02, 0.1, 0.5, 0.9].map((w) => atWeight(w).hash);
    expect(new Set(hashes).size).toBe(4);
  });

  it("scales the incoming deck's contribution by its unnormalized weight", () => {
    const palette = atWeight(0.1);
    const rhythm = atWeight(0.5);
    const baseAt = (cues: ShowCue[]): number => cues.find((c) => c.priority === 10)!.intensity;
    expect(baseAt(palette.cues)).toBeCloseTo(0.9 * 0.1, 6);
    expect(baseAt(rhythm.cues)).toBeCloseTo(0.9 * 0.5, 6);
  });

  it("drops nothing from the outgoing deck while it is audible", () => {
    const outgoing = atWeight(0.5).cues.filter((c) => c.priority === 12);
    expect(outgoing.length).toBe(1);
    expect(outgoing[0]!.intensity).toBeCloseTo(0.9, 6);
  });
});

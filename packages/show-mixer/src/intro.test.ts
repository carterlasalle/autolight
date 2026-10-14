import { describe, expect, it } from "vitest";
import { makeDeck, makeFixture } from "@autolight/simulator";
import type { Fixture, ShowCue, ShowPlan, TrackIdentity } from "@autolight/contracts";
import { renderFrame } from "@autolight/renderer";
import { introductionStage, mixDown, type DeckMix, type LayerTag } from "./index.js";

// P-67-introduction: frame-sampled across a fader ramp, the incoming deck's
// palette and secondary spatial layer enter first, then its rhythm layers,
// then its exclusive impacts, decided by layer tag (spec 67).

const trackA = { id: "a", sourceIds: {} } satisfies TrackIdentity;

const trackB = { id: "b", sourceIds: {} } satisfies TrackIdentity;

const BEAT = 64;

const fixtures: Fixture[] = [makeFixture("f1", 6, 0, 1, ["PRIMARY", "SECONDARY"])];

// Priorities deliberately ANTI-correlate with the layer order: the exclusive
// hit has the lowest priority and the base look the highest, so an admission
// decided by priority instead of layer tag cannot produce the stage ladder.
const PRIORITY = { exclusive: 1, accents: 5, spatial: 150, base: 200 } as const;
const OUTGOING_PRIORITY = 12;

const FADER_RAMP = [0.02, 0.1, 0.5, 0.9] as const;

const cue = (over: Partial<ShowCue> & Pick<ShowCue, "type">): ShowCue => ({
  startBeat: BEAT,
  durationBeats: 16,
  intensity: 0.9,
  target: "PRIMARY",
  priority: PRIORITY.base,
  ...over,
});

const incomingCues: ShowCue[] = [
  cue({ type: "section-look", target: "PRIMARY", priority: PRIORITY.base }), // base
  cue({ type: "chase-flip", target: "SECONDARY", durationBeats: 8, priority: PRIORITY.spatial }), // spatial
  cue({ type: "build-ramp", target: "ALL", durationBeats: 8, priority: PRIORITY.accents }), // accents
  cue({ type: "white-hit", target: "ALL", durationBeats: 0.25, intensity: 1, priority: PRIORITY.exclusive }), // exclusive
];

function atWeight(weight: number): { layers: LayerTag[]; outgoingLayers: LayerTag[]; cues: ShowCue[]; frame: number[]; litCells: number } {
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
    cues: [cue({ type: "section-look", target: "PRIMARY", priority: OUTGOING_PRIORITY })],
  };

  const mixed = mixDown(incoming, outgoing);
  const plan: ShowPlan = { schemaVersion: 1, plannerVersion: "x", trackId: "t", styleId: "s", seed: "a", cues: mixed.cues };
  const buf = renderFrame(plan, BEAT + 0.5, fixtures).get("f1") ?? new Uint8Array();
  let litCells = 0;

  for (let i = 0; i < buf.length; i += 3) {
    if ((buf[i] ?? 0) > 0 || (buf[i + 1] ?? 0) > 0 || (buf[i + 2] ?? 0) > 0) litCells += 1;
  }

  return {
    // The incoming deck is the first mix argument, so its layers carry side
    // "a"; the outgoing side is pinned too, so a silent side swap fails.
    layers: mixed.layers.filter((l) => l.side === "a").map((l) => l.tag),
    outgoingLayers: mixed.layers.filter((l) => l.side === "b").map((l) => l.tag),
    cues: mixed.cues,
    frame: [...buf],
    litCells,
  };
}

describe("incoming deck introduction (P-67)", () => {
  it("admits palette, then rhythm, then impacts in order across a fader ramp", () => {
    const stages = FADER_RAMP.map((w) => ({ weight: w, ...atWeight(w) }));
    expect(introductionStage(0.02)).toBe("silent");
    expect(introductionStage(0.1)).toBe("palette");
    expect(introductionStage(0.5)).toBe("rhythm");
    expect(introductionStage(0.9)).toBe("impacts");
    // Layer tags decide what enters; the cue priorities are inverted, so a
    // priority-ordered admission cannot pass these tags.
    expect(stages[0]!.layers).toEqual([]);
    expect(stages[1]!.layers).toEqual(["base", "spatial"]);
    expect(stages[2]!.layers).toEqual(["base", "spatial", "accents"]);
    expect(stages[3]!.layers).toEqual(["base", "spatial", "accents", "exclusive"]);
    // The outgoing deck keeps its base layer at every stage.
    for (const s of stages) expect(s.outgoingLayers).toEqual(["base"]);
  });

  it("samples a distinct frame at every stage", () => {
    const shots = FADER_RAMP.map((w) => atWeight(w));

    // The rendered BYTES differ between consecutive admissions, not only the
    // hash, and every stage still lights the rig (the outgoing deck plays).
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i]!.frame, `stage ${i}`).not.toEqual(shots[i - 1]!.frame);
    }

    for (const s of shots) expect(s.litCells).toBeGreaterThan(0);
  });

  it("scales the incoming deck's contribution by its unnormalized weight", () => {
    const silent = atWeight(0.02);
    const palette = atWeight(0.1);
    const rhythm = atWeight(0.5);
    const impacts = atWeight(0.9);
    const at = (cues: ShowCue[], priority: number): number | undefined => cues.find((c) => c.priority === priority)?.intensity;

    // Priorities are class-unique, so each lookup names the incoming deck's
    // cue of that class (the outgoing deck's section-look has its own).
    // Every admitted class scales by weight, at every stage it is admitted.
    expect(at(palette.cues, PRIORITY.base)).toBeCloseTo(0.9 * 0.1, 6);
    expect(at(rhythm.cues, PRIORITY.base)).toBeCloseTo(0.9 * 0.5, 6);
    expect(at(palette.cues, PRIORITY.spatial)).toBeCloseTo(0.9 * 0.1, 6);
    expect(at(rhythm.cues, PRIORITY.accents)).toBeCloseTo(0.9 * 0.5, 6);
    expect(at(rhythm.cues, PRIORITY.exclusive)).toBeUndefined();
    expect(at(impacts.cues, PRIORITY.exclusive)).toBeCloseTo(1 * 0.9, 6);
    // Nothing of the incoming deck reaches the mix while it is silent.
    expect(at(silent.cues, PRIORITY.base)).toBeUndefined();
    expect(at(silent.cues, PRIORITY.spatial)).toBeUndefined();
  });

  it("drops nothing from the outgoing deck while it is audible", () => {
    const outgoing = atWeight(0.5).cues.filter((c) => c.priority === OUTGOING_PRIORITY);
    expect(outgoing.length).toBe(1);
    expect(outgoing[0]!.intensity).toBeCloseTo(0.9, 6);
  });
});

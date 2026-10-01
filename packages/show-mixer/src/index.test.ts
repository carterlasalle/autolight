import { describe, expect, it } from "vitest";
import type { ShowCue, TrackIdentity } from "@autolight/contracts";
import {
  LAYERS,
  baseWeights,
  cueLayer,
  impactOwner,
  introductionStage,
  isExclusive,
  loadFastPath,
  mixDown,
  translateBlackout,
  type DeckMix,
} from "./index.js";
import { makeDeck } from "@autolight/simulator";

const trackA = { id: "a", sourceIds: {} } satisfies TrackIdentity;
const trackB = { id: "b", sourceIds: {} } satisfies TrackIdentity;

const cue = (over: Partial<ShowCue> & Pick<ShowCue, "type">): ShowCue => ({
  startBeat: 0,
  durationBeats: 1,
  intensity: 1,
  target: "PRIMARY",
  priority: 10,
  ...over,
});

describe("show-mixer", () => {
  it("gives exclusive ownership to the louder deck", () => {
    const a = makeDeck({ channelFader: 1, crossfader: 1, track: trackA });
    const b = makeDeck({ channelFader: 0.1, crossfader: 1, track: trackB });
    expect(impactOwner({ state: a, strength: 1 }, { state: b, strength: 1 })).toBe("a");
  });
  it("returns null when both decks are silent", () => {
    const a = makeDeck({ playing: false });
    const b = makeDeck({ playing: false });
    expect(impactOwner({ state: a, strength: 1 }, { state: b, strength: 1 })).toBeNull();
  });
  it("keeps the incumbent inside the hysteresis band (§65)", () => {
    const factors = { weight: 1, master: 0, confidence: 0, strength: 1, significance: 0 };
    const a = { state: makeDeck({ channelFader: 1, crossfader: 1, master: false, track: trackA }), strength: 0.9 };
    const b = { state: makeDeck({ channelFader: 1, crossfader: 1, master: false, track: trackB }), strength: 1 };
    expect(impactOwner(a, b, { factors, hysteresis: 0 })).toBe("b");
    expect(impactOwner(a, b, { factors, hysteresis: 0.2, current: "a" })).toBe("a");
    expect(impactOwner(a, b, { factors, hysteresis: 0.05, current: "a" })).toBe("b");
    expect(impactOwner(a, b, { factors, hysteresis: 0.2, current: "b" })).toBe("b");
  });
  it("returns unnormalized base weights, never a normalized split (§64)", () => {
    const a = makeDeck({ channelFader: 1, crossfader: 1, track: trackA });
    const b = makeDeck({ channelFader: 1, crossfader: 1, track: trackB });
    expect(baseWeights(a, b)).toEqual({ a: 1, b: 1 });
    const quiet = makeDeck({ channelFader: 0.3, crossfader: 1, master: false, track: trackA });
    expect(baseWeights(quiet, makeDeck({ playing: false }))).toEqual({ a: 0.3, b: 0 });
  });
  it("translates a blackout to a dip when the other deck is loud (DS-18)", () => {
    const fired = cue({ type: "blackout", target: "ALL", intensity: 0, priority: 95 });
    const loud = translateBlackout(fired, { policy: "auto", otherWeight: 0.4, side: "a", threshold: 0.3 });
    expect(loud.type).toBe("dip");
    expect(loud.target).toBe("LEFT");
    const quiet = translateBlackout(fired, { policy: "auto", otherWeight: 0.1, side: "a", threshold: 0.3 });
    expect(quiet).toEqual(fired);
  });
  it("introduces the incoming deck palette before impacts (§67)", () => {
    expect(introductionStage(0)).toBe("silent");
    expect(introductionStage(0.1)).toBe("palette");
    expect(introductionStage(0.5)).toBe("rhythm");
    expect(introductionStage(0.9)).toBe("impacts");
    expect(introductionStage(0.1, { paletteAt: 0.2, rhythmAt: 0.4, impactsAt: 0.8 })).toBe("silent");
  });
  it("tags cues with their spec 33 layer", () => {
    expect(cueLayer(cue({ type: "section-look" }))).toBe("base");
    expect(cueLayer(cue({ type: "chase-flip" }))).toBe("spatial");
    expect(cueLayer(cue({ type: "build-ramp" }))).toBe("accents");
    expect(cueLayer(cue({ type: "white-hit" }))).toBe("exclusive");
    // An explicit planner tag wins over the mapping.
    const tagged = { ...cue({ type: "impact" }), layer: "rhythm" };
    expect(cueLayer(tagged)).toBe("rhythm");
    expect(LAYERS).toHaveLength(8);
  });
  it("marks exclusive impact types", () => {
    expect(isExclusive("white-hit")).toBe(true);
    expect(isExclusive("blackout")).toBe(true);
    expect(isExclusive("build-ramp")).toBe(false);
  });
  it("mixes two decks with a single impact owner and recorded reasons", () => {
    const a: DeckMix = {
      state: makeDeck({ deckId: 1, channelFader: 1, crossfader: 1, track: trackA }),
      beat: 64,
      impactStrength: 0.4,
      cues: [
        cue({ type: "white-hit", startBeat: 64, durationBeats: 0.25, target: "ALL", priority: 100 }),
        cue({ type: "section-look", startBeat: 64, durationBeats: 32, intensity: 0.8, priority: 10 }),
      ],
    };
    const b: DeckMix = {
      state: makeDeck({ deckId: 2, channelFader: 1, crossfader: 1, track: trackB }),
      beat: 64,
      impactStrength: 0.9,
      cues: [cue({ type: "impact", startBeat: 64, target: "PRIMARY", priority: 90 })],
    };
    const mixed = mixDown(a, b);
    expect(mixed.owner).toBe("b");
    // Loser's exclusive is dropped with a reason; base looks from both survive.
    expect(mixed.cues.filter((c) => c.type === "white-hit")).toHaveLength(0);
    expect(mixed.dropped.map((d) => d.cue.type)).toEqual(["white-hit"]);
    expect(mixed.dropped[0]!.reason).toMatch(/exclusive ownership/);
    expect(mixed.cues.filter((c) => c.type === "section-look")).toHaveLength(1);
    expect(mixed.weights).toEqual({ a: 1, b: 1 });
    expect(mixed.blendSpace).toBe("oklab-hue-linear-intensity");
    // Layers group the surviving cues in spec 33 order.
    expect(mixed.layers.map((l) => `${l.side}:${l.tag}`)).toEqual(["a:base", "b:exclusive"]);
    expect(mixed.cues.every((c) => c.intensity <= 1)).toBe(true);
  });
  it("mutes rhythm and impacts while a deck is only introducing its palette", () => {
    const quiet: DeckMix = {
      state: makeDeck({ deckId: 1, channelFader: 0.1, crossfader: 1, master: false, track: trackA }),
      beat: 0,
      impactStrength: 1,
      cues: [cue({ type: "impact", target: "ALL", priority: 90 }), cue({ type: "section-look", durationBeats: 8, intensity: 0.8 })],
    };
    const loud: DeckMix = {
      state: makeDeck({ deckId: 2, channelFader: 1, crossfader: 1, master: false, track: trackB }),
      beat: 0,
      impactStrength: 1,
      cues: [],
    };
    const mixed = mixDown(quiet, loud);
    expect(mixed.cues.filter((c) => c.type === "impact")).toHaveLength(0);
    expect(mixed.cues.filter((c) => c.type === "section-look")).toHaveLength(1);
    expect(mixed.dropped.map((d) => d.reason)).toEqual(["introduction stage palette does not admit the exclusive layer"]);
  });
  it("loads cached track+plan on the fast path (§138)", () => {
    const store = {
      loadArtifact: (trackId: string) => (trackId === "t" ? "/cache/t.json" : null),
      loadShowPlan: () => "{\"plan\":true}",
    };
    expect(loadFastPath(store, "t", "0.1.0", "fp", "club", "0.1.0")).toEqual({ trackJson: "/cache/t.json", planJson: "{\"plan\":true}" });
    expect(loadFastPath(store, "missing", "0.1.0", "fp", "club", "0.1.0")).toEqual({ trackJson: null, planJson: null });
  });
});

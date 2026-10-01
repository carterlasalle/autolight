import { describe, expect, it } from "vitest";
import { makeDeck } from "@autolight/simulator";
import type { DeckState, TrackIdentity } from "@autolight/contracts";
import { DEFAULT_ASSIGNMENT, resolveCrossfader, sideOf, type CrossfaderSide } from "@autolight/dj-core";
import { baseWeights, crossfaderGainOf, deckWeightOf } from "./index.js";

// P-63-crossfader: hard left gives A 1, B 0; hard right gives A 0, B 1 for the
// default assignment; the centre follows the curve; THRU ignores the
// crossfader; and the DS-26 source decides where curve and position come from.

const track = { id: "t", sourceIds: {} } satisfies TrackIdentity;

function deck(over: Partial<DeckState> = {}): DeckState {
  return makeDeck({ channelFader: 1, crossfader: 1, master: false, track, ...over });
}

describe("audible weight (P-63)", () => {
  it("gives A the hard left and B the hard right for the default assignment", () => {
    expect(deckWeightOf(deck({ deckId: 1 }), { position: 0 })).toBe(1);
    expect(deckWeightOf(deck({ deckId: 2 }), { position: 0 })).toBe(0);
    expect(deckWeightOf(deck({ deckId: 1 }), { position: 1 })).toBe(0);
    expect(deckWeightOf(deck({ deckId: 2 }), { position: 1 })).toBe(1);
  });

  it("follows the curve at the centre (spec 63)", () => {
    const linear = { a: deckWeightOf(deck({ deckId: 1 }), { position: 0.5 }), b: deckWeightOf(deck({ deckId: 2 }), { position: 0.5 }) };
    expect(linear.a).toBeCloseTo(0.5, 6);
    expect(linear.b).toBeCloseTo(0.5, 6);
    const power = {
      a: deckWeightOf(deck({ deckId: 1 }), { position: 0.5, crossfader: { curve: "constant-power" } }),
      b: deckWeightOf(deck({ deckId: 2 }), { position: 0.5, crossfader: { curve: "constant-power" } }),
    };
    expect(power.a).toBeCloseTo(Math.SQRT1_2, 6);
    expect(power.b).toBeCloseTo(Math.SQRT1_2, 6);
    const cut = {
      a: deckWeightOf(deck({ deckId: 1 }), { position: 0.5, crossfader: { curve: "sharp-cut" } }),
      b: deckWeightOf(deck({ deckId: 2 }), { position: 0.5, crossfader: { curve: "sharp-cut" } }),
    };
    expect(cut.a).toBe(0);
    expect(cut.b).toBe(1);
  });

  it("ignores the crossfader for a THRU deck", () => {
    for (const position of [0, 0.3, 0.5, 1]) {
      expect(deckWeightOf(deck({ deckId: 3 }), { position })).toBe(1);
    }
    // A custom assignment moves the deck to the other side.
    const assignment: Record<string, CrossfaderSide> = { "1": "B", "2": "A" };
    expect(deckWeightOf(deck({ deckId: 1 }), { position: 1, crossfader: { assignment } })).toBe(1);
    expect(deckWeightOf(deck({ deckId: 1 }), { position: 0, crossfader: { assignment } })).toBe(0);
    expect(sideOf(3, DEFAULT_ASSIGNMENT)).toBe("THRU");
  });

  it("adds the master bonus on top of the curve gain", () => {
    expect(deckWeightOf(deck({ deckId: 2, master: false }), { position: 1 })).toBe(1);
    expect(deckWeightOf(deck({ deckId: 2, channelFader: 0.5, master: true }), { position: 1 })).toBeCloseTo(0.55, 6);
  });

  it("chooses the curve and position source per DS-26", () => {
    expect(resolveCrossfader("auto", { software: 0.2, controller: 0.9 })).toMatchObject({ position: 0.2, source: "software", fellBack: false });
    expect(resolveCrossfader("auto", { controller: 0.9, configured: 0.4 })).toMatchObject({ position: 0.9, source: "controller" });
    expect(resolveCrossfader("auto", { configured: 0.4 })).toMatchObject({ position: 0.4, source: "configured" });
    const missing = resolveCrossfader("software", { controller: 0.9 });
    expect(missing.fellBack).toBe(true);
    expect(missing.position).toBe(0.5);
    expect(resolveCrossfader("auto", { software: 0.2, controller: 0.9 }).spread).toBeCloseTo(0.7, 6);
  });

  it("stays inside [0, 1] and monotone over a fader sweep (property)", () => {
    let seed = 12345;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const fader = rand();
    const bMaster = rand() > 0.5;
    let previousA = Number.POSITIVE_INFINITY;
    let previousB = -1;
    for (let i = 0; i < 200; i += 1) {
      const position = (i + 0.5) / 200;
      const a = deckWeightOf(deck({ deckId: 1, channelFader: fader }), { position });
      const b = deckWeightOf(deck({ deckId: 2, channelFader: fader, master: bMaster }), { position });
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(previousA + 1e-9);
      expect(b).toBeGreaterThanOrEqual(previousB - 1e-9);
      previousA = a;
      previousB = b;
    }
  });

  it("weights both decks for the mixer, unnormalized (spec 64)", () => {
    const left = baseWeights(deck({ deckId: 1 }), deck({ deckId: 2 }), { position: 0 });
    expect(left).toEqual({ a: 1, b: 0 });
    const right = baseWeights(deck({ deckId: 1 }), deck({ deckId: 2 }), { position: 1 });
    expect(right).toEqual({ a: 0, b: 1 });
    const centre = baseWeights(deck({ deckId: 1 }), deck({ deckId: 2 }), { position: 0.5 });
    expect(centre.a).toBeCloseTo(0.5, 6);
    expect(centre.b).toBeCloseTo(0.5, 6);
    // Without an explicit position each deck reports its own software value.
    expect(baseWeights(deck({ deckId: 1, crossfader: 0.5 }), deck({ deckId: 2, crossfader: 0.25 }))).toEqual({ a: 0.5, b: 0.25 });
  });

  it("reads the crossfader gain per deck side through the mixer helper", () => {
    expect(crossfaderGainOf(0, 1)).toBe(1);
    expect(crossfaderGainOf(0, 2)).toBe(0);
    expect(crossfaderGainOf(1, 1)).toBe(0);
    expect(crossfaderGainOf(1, 2)).toBe(1);
    expect(crossfaderGainOf(0.25, 3)).toBe(1);
  });
});

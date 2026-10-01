import { describe, expect, it } from "vitest";
import { makeDeck } from "@autolight/simulator";
import type { DeckState } from "@autolight/contracts";
import {
  baseWeights,
  crossfaderGainOf,
  deckWeightOf,
  impactOwner,
  introductionStage,
  ownerScore,
} from "./index.js";

// T-QA-12 mixer weight properties (spec 63 to 65, T-MIX-01/03).
// Deterministic sweep, no extra dependency. A weight outside 0..1, a silent
// deck that scores, or an ownership flip without a score win fails below.

const track = { id: "t", sourceIds: {} };
const deck = (over: Partial<DeckState> = {}): DeckState =>
  makeDeck({ channelFader: 1, crossfader: 1, master: false, track, ...over });

describe("mixer weight properties", () => {
  it("keeps every weight inside 0..1 across the fader square", () => {
    for (let c = 0; c <= 10; c++) {
      for (let p = 0; p <= 10; p++) {
        const w = deckWeightOf(deck({ channelFader: c / 10, master: (c % 2 === 0) }), { position: p / 10 });
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    }
  });

  it("gives a silent deck zero weight, zero score, and no ownership", () => {
    for (const silent of [
      deck({ track: null }),
      deck({ playing: false }),
      deck({ channelFader: 0 }),
    ]) {
      expect(deckWeightOf(silent, { position: 0.5 })).toBe(0);
      const input = { state: silent, strength: 1, confidence: 1 };
      expect(ownerScore(input)).toBe(0);
      expect(impactOwner(input, input)).toBeNull();
    }
  });

  it("hands hard left to A and hard right to B, centre shared", () => {
    const a = deck({ deckId: 1 });
    const b = deck({ deckId: 2 });
    expect(deckWeightOf(a, { position: 0 })).toBe(1);
    expect(deckWeightOf(b, { position: 0 })).toBe(0);
    expect(deckWeightOf(a, { position: 1 })).toBe(0);
    expect(deckWeightOf(b, { position: 1 })).toBe(1);
    expect(baseWeights(a, b, { position: 0.5 })).toEqual({ a: 0.5, b: 0.5 });
    expect(crossfaderGainOf(0.5, 1)).toBeCloseTo(0.5);
  });

  it("lets the louder deck own impacts and keeps the incumbent on ties", () => {
    const loud = { state: deck({ deckId: 1 }), strength: 1, confidence: 1 };
    const quiet = { state: deck({ deckId: 2, channelFader: 0.1 }), strength: 0.1, confidence: 0.2 };
    expect(impactOwner(loud, quiet)).toBe("a");
    expect(impactOwner(quiet, loud)).toBe("b");
    // Exact ties keep the incumbent deck (hysteresis), so a fresh tie
    // without an incumbent resolves to the first deck.
    expect(impactOwner(loud, { ...loud, state: deck({ deckId: 2 }) })).toBe("a");
    expect(impactOwner(loud, loud, { current: "b" })).toBe("b");
  });

  it("walks the intro stages in order", () => {
    expect(introductionStage(0)).toBe("silent");
    expect(introductionStage(0.05)).toBe("palette");
    expect(introductionStage(0.3)).toBe("rhythm");
    expect(introductionStage(0.7)).toBe("impacts");
    expect(introductionStage(1)).toBe("impacts");
  });
});

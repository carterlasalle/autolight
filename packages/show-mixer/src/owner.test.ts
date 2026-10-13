import { describe, expect, it } from "vitest";
import { makeDeck, makeFixture } from "@autolight/simulator";
import type { Fixture, ShowCue, ShowPlan, TrackIdentity } from "@autolight/contracts";
import { frameHash, renderFrame } from "@autolight/renderer";
import { impactOwner, mixDown, ownerScore, type DeckMix } from "./index.js";

// P-65-owner: exclusive resources (blackout, strobe, white hit, full-room
// impact) are owned by one deck, chosen by weight, master status, event
// confidence, event strength and structural significance, with hysteresis.
// P-65-no-leak: a non-owner's white hit changes no pixel.

const trackA = { id: "a", sourceIds: {} } satisfies TrackIdentity;

const trackB = { id: "b", sourceIds: {} } satisfies TrackIdentity;

const cue = (over: Partial<ShowCue> & Pick<ShowCue, "type">): ShowCue => ({
  startBeat: 64,
  durationBeats: 4,
  intensity: 0.8,
  target: "PRIMARY",
  priority: 10,
  ...over,
});

const factors = { weight: 1, master: 0.3, confidence: 0.5, strength: 1, significance: 0.5 };

function score(over: { channelFader?: number; master?: boolean; strength?: number; confidence?: number; significance?: number; cues?: ShowCue[] }): number {
  return ownerScore(
    {
      state: makeDeck({ deckId: 1, channelFader: over.channelFader ?? 1, crossfader: 1, master: over.master ?? false, track: trackA }),
      strength: over.strength ?? 1,
      ...(over.confidence === undefined ? {} : { confidence: over.confidence }),
      ...(over.significance === undefined ? {} : { significance: over.significance }),
      ...(over.cues === undefined ? {} : { cues: over.cues }),
    },
    { factors },
  );
}

describe("exclusive impact ownership (P-65)", () => {
  it("honors custom factors instead of the defaults", () => {
    // Default factors: deck a wins on weight (2.5 vs 2.3). Zeroing the
    // weight factor removes a's only edge, so b wins (1.5 vs 1.8). An impl
    // that ignored opts.factors could not produce both outcomes.
    const a = { state: makeDeck({ deckId: 1, channelFader: 1, crossfader: 1, master: false, track: trackA }), strength: 1 };
    const b = { state: makeDeck({ deckId: 2, channelFader: 0.5, crossfader: 1, master: true, track: trackB }), strength: 1 };
    expect(impactOwner(a, b)).toBe("a");
    expect(impactOwner(a, b, { factors: { ...factors, weight: 0 } })).toBe("b");
  });

  it("weighs every spec 65 factor", () => {
    expect(score({ channelFader: 1 })).toBeGreaterThan(score({ channelFader: 0.5 }));
    expect(score({ master: true })).toBeGreaterThan(score({ master: false }));
    expect(score({ confidence: 1 })).toBeGreaterThan(score({ confidence: 0.2 }));
    expect(score({ strength: 1 })).toBeGreaterThan(score({ strength: 0.4 }));
    // Structural significance comes from the exclusive cue type.
    expect(score({ cues: [cue({ type: "white-hit" })] })).toBeGreaterThan(score({ cues: [cue({ type: "strobe" })] }));
    // A silent deck owns nothing, whatever else it reports.
    expect(score({ channelFader: 0, master: true, strength: 1 })).toBe(0);
  });

  it("hands the exclusive to the better deck and holds it through hysteresis", () => {
    const a = { state: makeDeck({ deckId: 1, channelFader: 1, crossfader: 1, master: false, track: trackA }), strength: 1 };
    const b = { state: makeDeck({ deckId: 2, channelFader: 0.9, crossfader: 1, master: true, track: trackB }), strength: 0.9 };
    // Deck b wins deterministically: weight 0.9 + master 0.3 + confidence
    // 1*0.5 + strength 0.9 + significance 0.5 = 2.6 vs a's 2.5.
    const first = impactOwner(a, b, { factors, hysteresis: 0 });
    expect(first).toBe("b");
    expect(impactOwner(a, b, { factors, hysteresis: 0.5, current: first })).toBe(first);
    // A decisive challenger takes over even against hysteresis.
    const strong = { state: makeDeck({ deckId: 2, channelFader: 1, crossfader: 1, master: true, track: trackB }), strength: 1, confidence: 1 };
    expect(impactOwner({ ...a, strength: 0.2 }, strong, { factors, hysteresis: 0.5, current: "a" })).toBe("b");
  });

  it("feeds ownership from the mix-down with the deck's real cues", () => {
    const a: DeckMix = {
      state: makeDeck({ deckId: 1, channelFader: 1, crossfader: 1, master: false, track: trackA }),
      beat: 64,
      impactStrength: 0.5,
      cues: [cue({ type: "impact" })],
    };

    const b: DeckMix = {
      state: makeDeck({ deckId: 2, channelFader: 1, crossfader: 1, master: true, track: trackB }),
      beat: 64,
      impactStrength: 0.9,
      confidence: 1,
      cues: [cue({ type: "white-hit", target: "ALL", durationBeats: 0.25, priority: 100 })],
    };

    const mixed = mixDown(a, b, { factors });
    expect(mixed.owner).toBe("b");
    // The surviving white-hit is the winner's cue, properties preserved
    // (intensity scaled by the winner's weight of 1, so unchanged).
    expect(mixed.cues).toContainEqual(
      expect.objectContaining({ type: "white-hit", target: "ALL", durationBeats: 0.25, intensity: 0.8, priority: 100 }),
    );
    // The loser's impact is dropped by the ownership branch, not the intro.
    expect(mixed.dropped.map((d) => d.cue.type)).toEqual(["impact"]);
    expect(mixed.dropped[0]?.reason).toMatch(/exclusive ownership/);
  });

  it("changes no pixel for the non-owner's white hit (P-65-no-leak)", () => {
    const fixtures: Fixture[] = [makeFixture("f1", 6, 0, 1, ["PRIMARY"])];

    const owner: DeckMix = {
      state: makeDeck({ deckId: 1, channelFader: 1, crossfader: 1, master: true, track: trackA }),
      beat: 64,
      impactStrength: 1,
      cues: [cue({ type: "section-look", startBeat: 64, durationBeats: 32, intensity: 0.9 })],
    };

    const loserWhiteHit = cue({ type: "white-hit", startBeat: 64, durationBeats: 0.25, intensity: 1, target: "ALL", priority: 100 });

    const loser: DeckMix = {
      state: makeDeck({ deckId: 2, channelFader: 0.2, crossfader: 1, master: false, track: trackB }),
      beat: 64,
      impactStrength: 0.2,
      cues: [loserWhiteHit],
    };

    const mixed = mixDown(owner, loser);
    expect(mixed.owner).toBe("a");
    expect(mixed.cues.some((c) => c.type === "white-hit")).toBe(false);

    const plan = (cues: ShowCue[]): ShowPlan => ({ schemaVersion: 1, plannerVersion: "x", trackId: "t", styleId: "s", seed: "a", cues });
    const clean = renderFrame(plan(mixed.cues), 64, fixtures);
    // A leak would be visible: adding the non-owner's white hit changes pixels.
    const leaked = renderFrame(plan([...mixed.cues, loserWhiteHit]), 64, fixtures);
    expect(frameHash(leaked)).not.toBe(frameHash(clean));

    // The mixed frame is the owner's look only: no cell is white.
    for (const bytes of clean.values()) {
      for (let i = 0; i < bytes.length; i += 3) {
        expect(bytes[i] === 255 && bytes[i + 1] === 255 && bytes[i + 2] === 255).toBe(false);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { partyPaletteNames, type PartyEffectName } from "@autolight/ipc";
import { PARTY_PALETTES, partyFrame, type Rgb } from "./party-effects.js";

// The LED_PARTY port's frame math, without sockets: each effect is a pure
// function of tick, so the looks are pinned here instead of by eye.

const a: Rgb = [255, 0, 0];
const b: Rgb = [0, 0, 255];
const palette: Rgb[] = [[1, 2, 3], [4, 5, 6]];
const opts = { groups: 2, a, b, palette, stepMs: 100 };
// 1000 ms beat at a 100 ms tick: ten ticks per beat.
const beat = { ...opts, beatMs: 1000 };

// First group's colour, with the contract asserted: a frame must produce one
// colour per requested group.
function first(effect: PartyEffectName, tick: number, o: typeof opts): Rgb {
  const [head] = partyFrame(effect, tick, o);

  if (head === undefined) throw new Error(`partyFrame(${effect}) returned no groups`);

  return head;
}

describe("party effects (LED_PARTY port)", () => {
  it("strobes: black on odd ticks, palette colour steps every two ticks", () => {
    expect(partyFrame("strobe", 0, opts)).toEqual([[1, 2, 3], [1, 2, 3]]);
    expect(partyFrame("strobe", 1, opts)).toEqual([[0, 0, 0], [0, 0, 0]]);
    expect(partyFrame("strobe", 2, opts)).toEqual([[4, 5, 6], [4, 5, 6]]);
  });

  it("jumps through the palette every tick", () => {
    expect(first("jump", 0, opts)).toEqual([1, 2, 3]);
    expect(first("jump", 1, opts)).toEqual([4, 5, 6]);
    expect(first("jump", 2, opts)).toEqual([1, 2, 3]);
  });

  it("spot lights one group at a time and wraps", () => {
    expect(partyFrame("spot", 0, opts)).toEqual([a, [0, 0, 0]]);
    expect(partyFrame("spot", 1, opts)).toEqual([[0, 0, 0], a]);
    expect(partyFrame("spot", 2, opts)).toEqual([a, [0, 0, 0]]);
  });

  it("wash travels A to B and back, staying in range", () => {
    expect(first("wash", 0, opts)).toEqual(a);
    expect(first("wash", 4, opts)).toEqual(b);

    for (let t = 0; t < 16; t++) {
      const [r, g, bl] = first("wash", t, opts);

      expect(Math.min(r, g, bl)).toBeGreaterThanOrEqual(0);
      expect(Math.max(r, g, bl)).toBeLessThanOrEqual(255);
    }
  });

  it("pulse breathes from dark to the palette colour", () => {
    // Full-scale palette here: brightness comparisons are meaningless at
    // palette values small enough for rounding to flatten the ramp.
    const white: Rgb[] = [[255, 255, 255]];
    const bright = { ...opts, palette: white };

    expect(first("pulse", 0, bright)).toEqual([0, 0, 0]);

    const mid = first("pulse", 2, bright);
    const peak = first("pulse", 4, bright);

    expect(peak).toEqual([255, 255, 255]);
    expect(mid[0]).toBeGreaterThan(0);
    expect(mid[0]).toBeLessThan(peak[0]);
  });

  it("beat flash hits white at the beat top and dies within one tick", () => {
    expect(first("beat-flash", 0, beat)).toEqual([255, 255, 255]);
    expect(first("beat-flash", 1, beat)).toEqual([0, 0, 0]);
    expect(first("beat-flash", 9, beat)).toEqual([0, 0, 0]);
    // Tick 10 = the top of beat 1.
    expect(first("beat-flash", 10, beat)).toEqual([255, 255, 255]);
  });

  it("beat cycle holds one palette colour per beat", () => {
    expect(first("beat-cycle", 0, beat)).toEqual([1, 2, 3]);
    expect(first("beat-cycle", 5, beat)).toEqual([1, 2, 3]);
    expect(first("beat-cycle", 10, beat)).toEqual([4, 5, 6]);
    expect(first("beat-cycle", 20, beat)).toEqual([1, 2, 3]);
  });

  it("beat alternate swaps A and B each beat", () => {
    expect(first("beat-alternate", 0, beat)).toEqual(a);
    expect(first("beat-alternate", 10, beat)).toEqual(b);
    expect(first("beat-alternate", 20, beat)).toEqual(a);
  });

  it("beat rainbow blasts the downbeat and dims the rest of the bar", () => {
    expect(first("beat-rainbow", 0, beat)).toEqual([1, 2, 3]);

    const offbeat = first("beat-rainbow", 10, beat);

    expect(offbeat).not.toEqual([1, 2, 3]);
    expect(offbeat).not.toEqual([0, 0, 0]);
    // Next bar's downbeat: beat 4, palette colour 2.
    expect(first("beat-rainbow", 40, beat)).toEqual([4, 5, 6]);
  });

  it("beat effects hold colour A with no tempo, and the palette covers every name", () => {
    expect(first("beat-flash", 0, opts)).toEqual(a);
    expect(first("beat-cycle", 0, opts)).toEqual(a);
    expect(Object.keys(PARTY_PALETTES).sort()).toEqual([...partyPaletteNames].sort());
  });
});

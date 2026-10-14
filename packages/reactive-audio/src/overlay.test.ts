import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAY_CAP,
  applyOverlayLinear,
  applyOverlayScalar,
  overlayAmount,
  overlayGain,
} from "./overlay.js";

// P-69-no-relight: at maximum reactive input the overlay scales planned light
// only (black stays black, hue preserved) and follows style.reactiveAmount.

describe("overlay rules (P-69)", () => {
  it("keeps black black at maximum energy", () => {
    expect(DEFAULT_OVERLAY_CAP).toBe(0.2);
    expect(applyOverlayScalar(0, 1, 1)).toBe(0);
    expect(applyOverlayLinear([0, 0, 0], 1, 1)).toEqual([0, 0, 0]);
  });

  it("bounds the bump by cap times reactiveAmount at maximum energy", () => {
    const cap = 0.2;
    const amount = 0.5;
    expect(overlayAmount(cap, amount)).toBeCloseTo(0.1, 12);
    expect(applyOverlayScalar(0.5, 1, amount, cap)).toBeCloseTo(0.55, 12);
    // Exact values: 0.9 * (1 + 0.2*0.5) = 0.99, and at full amount the bump
    // clamps at exactly 1 — an upper bound alone would pass for a bump that
    // never applied (batch-15).
    expect(applyOverlayScalar(0.9, 1, 0.5, cap)).toBeCloseTo(0.99, 12);
    expect(applyOverlayScalar(0.9, 1, 1, cap)).toBe(1);
    expect(overlayGain(1, 1, cap)).toBeCloseTo(1 + cap, 12);
  });

  it("preserves hue by scaling every channel with the same factor", () => {
    const planned: [number, number, number] = [0.6, 0.3, 0.15];
    const out = applyOverlayLinear(planned, 1, 0.5);
    const gain = out[0]! / planned[0]!;
    expect(gain).toBeGreaterThan(1);
    expect(out[1]! / planned[1]!).toBeCloseTo(gain, 12);
    expect(out[2]! / planned[2]!).toBeCloseTo(gain, 12);
    // Zero channels stay zero while lit channels grow: no relight, no hue
    // shift. The pinned literal keeps the DEFAULT_OVERLAY_CAP assertion
    // independent of the module constant (batch-15).
    const darkRed = applyOverlayLinear([0.4, 0, 0], 1, 1);
    expect(darkRed).toEqual([0.48, 0, 0]);
    // A full-bright channel pins the joint factor: independent per-channel
    // clamping would return (1, 0.55, 0.275) here, a hue shift.
    expect(applyOverlayLinear([1, 0.5, 0.25], 1, 0.5)).toEqual([1, 0.5, 0.25]);
  });

  it("is silent without energy or style amount", () => {
    expect(applyOverlayScalar(0.7, 0, 1)).toBeCloseTo(0.7, 12);
    expect(applyOverlayScalar(0.7, 1, 0)).toBeCloseTo(0.7, 12);
    expect(applyOverlayLinear([0.5, 0.25, 0.125], 0, 1)).toEqual([0.5, 0.25, 0.125]);
  });

  it("clamps wild inputs instead of exploding", () => {
    // One clamp per assertion so a failure names the input it comes from.
    expect(applyOverlayScalar(2, 1, 0.5)).toBe(1);
    expect(applyOverlayScalar(0.5, 2, 0.5)).toBeCloseTo(applyOverlayScalar(0.5, 1, 0.5), 12);
    expect(applyOverlayScalar(0.5, 1, 5)).toBeCloseTo(applyOverlayScalar(0.5, 1, 1), 12);
    expect(applyOverlayScalar(-1, 1, 1)).toBe(0);
    // +Infinity clamps to full light, never to black.
    expect(applyOverlayScalar(Number.POSITIVE_INFINITY, 1, 1)).toBe(1);
    expect(applyOverlayLinear([Number.POSITIVE_INFINITY, 0, 0], 1, 1)).toEqual([1, 0, 0]);
    expect(overlayAmount(99, 99)).toBe(1);
  });
});

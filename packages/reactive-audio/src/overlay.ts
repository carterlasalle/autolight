// Overlay rules (T-AUD-03, spec 69).
//
// The live-audio overlay may only scale light the planned layers already
// produced: pulse envelope, small brightness bump, sparkle density, minor
// segment displacement, decay rate, micro accents. It can never change
// section, declare a drop, replace the palette, strobe, or discard the show:
// by construction this module takes planned light plus audio energy and
// returns scaled light, never a cue or palette.
//
// Two invariants close F-AUD-02:
// - Black stays black: a planned value of 0 returns 0 at any energy.
// - Hue is preserved: all channels scale by the same factor in linear light,
//   so ratios never change (callers MUST use applyOverlayLinear for RGB and
//   never call the scalar per channel with different energies).
//
// Amount is `audio.overlay.cap` times `style.reactiveAmount` (spec 68): the
// exact percentage is style-dependent, the cap keeps it subtle. F-AUD-04's
// hardcoded MAX_OVERLAY_GAIN becomes the DEFAULT_OVERLAY_CAP default here;
// callers pass the configured cap explicitly.

/** audio.overlay.cap default: was MAX_OVERLAY_GAIN in index.ts. */
export const DEFAULT_OVERLAY_CAP = 0.2;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** Final overlay amount: cap times style reactiveAmount, both clamped. */
export function overlayAmount(cap: number = DEFAULT_OVERLAY_CAP, reactiveAmount: number): number {
  return clamp01(cap) * clamp01(reactiveAmount);
}

/** Relative gain for one tick: 1 at silence, up to 1 + amount at full energy. */
export function overlayGain(energy: number, reactiveAmount: number, cap: number = DEFAULT_OVERLAY_CAP): number {
  return 1 + clamp01(energy) * overlayAmount(cap, reactiveAmount);
}

// Scalar planned light in linear 0..1: black stays black, bump is bounded by
// planned * amount, result never exceeds 1.
export function applyOverlayScalar(
  planned: number,
  energy: number,
  reactiveAmount: number,
  cap: number = DEFAULT_OVERLAY_CAP,
): number {
  const p = clamp01(planned);
  if (p === 0) return 0;
  return Math.min(1, p * overlayGain(energy, reactiveAmount, cap));
}

// RGB in linear light: every channel scales by the SAME factor, so hue is
// preserved and black (0,0,0) stays black.
export function applyOverlayLinear(
  planned: readonly [number, number, number],
  energy: number,
  reactiveAmount: number,
  cap: number = DEFAULT_OVERLAY_CAP,
): [number, number, number] {
  const gain = overlayGain(energy, reactiveAmount, cap);
  const scale = (v: number): number => {
    const c = clamp01(v);
    if (c === 0) return 0;
    return Math.min(1, c * gain);
  };
  return [scale(planned[0]!), scale(planned[1]!), scale(planned[2]!)];
}

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
  // NaN is no light; +Infinity is maximum light (folding it to 0 would
  // render a runaway input black); negatives clamp to 0.
  if (Number.isNaN(v)) return 0;

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

// One joint factor for every clamped channel: hue survives even when the
// bump would push a channel past 1 (independent per-channel clamping would
// shift the colour). A channel at 1 pins the factor so ratios are exact.
function overlayFactor(channels: readonly number[], gain: number): number {
  let max = 0;

  for (const v of channels) max = Math.max(max, clamp01(v));

  return max === 0 ? 0 : Math.min(gain, 1 / max);
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

  return p * overlayFactor([p], overlayGain(energy, reactiveAmount, cap));
}

// RGB in linear light: every channel scales by the SAME factor, so hue is
// preserved and black (0,0,0) stays black.
export function applyOverlayLinear(
  planned: readonly [number, number, number],
  energy: number,
  reactiveAmount: number,
  cap: number = DEFAULT_OVERLAY_CAP,
): [number, number, number] {
  const c0 = clamp01(planned[0]!);
  const c1 = clamp01(planned[1]!);
  const c2 = clamp01(planned[2]!);
  const f = overlayFactor([c0, c1, c2], overlayGain(energy, reactiveAmount, cap));

  return [c0 * f, c1 * f, c2 * f];
}

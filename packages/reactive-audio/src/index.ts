// Live audio may only nudge brightness/sparkle (§69); never strobe/palette/drop.
export const MAX_OVERLAY_GAIN = 0.2; // ponytail: fixed cap, style-tune after listening tests
export function applyOverlay(planned: number, energy: number, reactiveAmount: number): number {
  const clamped = Math.min(1, Math.max(0, energy)) * Math.min(1, Math.max(0, reactiveAmount));
  return Math.min(1, planned + clamped * MAX_OVERLAY_GAIN);
}

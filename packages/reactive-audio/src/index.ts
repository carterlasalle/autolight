// Live audio may only nudge brightness/sparkle (§69); never strobe/palette/drop.
export const MAX_OVERLAY_GAIN = 0.2; // Fixed cap; now audio.overlay.cap times style.reactiveAmount (T-AUD-03).
export function applyOverlay(planned: number, energy: number, reactiveAmount: number): number {
  const clamped = Math.min(1, Math.max(0, energy)) * Math.min(1, Math.max(0, reactiveAmount));
  return Math.min(1, planned + clamped * MAX_OVERLAY_GAIN);
}

// Adaptive director (§71): phrase-length looks with cooldowns, not beat reactions.
export type AdaptiveLook = "hold" | "swell" | "dip" | "shift";
export interface DirectorState {
  phraseCount: number;
  recentLooks: AdaptiveLook[];
  cooldowns: Record<string, number>;
  palette: number;
}
export function nextLook(state: DirectorState, energyHigh: boolean, seed: number): { look: AdaptiveLook; state: DirectorState } {
  const cooled = Object.fromEntries(Object.entries(state.cooldowns).map(([k, v]) => [k, Math.max(0, v - 1)]));
  const options: AdaptiveLook[] = energyHigh ? ["swell", "shift", "hold"] : ["hold", "dip", "shift"];
  const avail = options.filter((o) => !(cooled[o]! > 0));
  const look = avail[seed % avail.length] ?? "hold";
  return {
    look,
    state: {
      phraseCount: state.phraseCount + 1,
      recentLooks: [...state.recentLooks.slice(-3), look],
      cooldowns: { ...cooled, [look]: 2 },
      palette: state.palette,
    },
  };
}

// Live audio surfaces: capture host (T-AUD-01), independent DSP (T-AUD-02)
// including the AGC, timing alignment (T-AUD-04) and the overlay rules
// (T-AUD-03).
export * from "./capture.js";
export * from "./dsp.js";
export * from "./overlay.js";
export * from "./timing.js";

import { DEFAULT_OVERLAY_CAP, applyOverlayScalar } from "./overlay.js";

// Live audio may only nudge brightness/sparkle (§69); never strobe/palette/drop.
// Legacy scalar entry: delegates to overlay.ts so the configured
// audio.overlay.cap is honored and black stays black (F-AUD-02/04, T-AUD-03).
export function applyOverlay(planned: number, energy: number, reactiveAmount: number, cap: number = DEFAULT_OVERLAY_CAP): number {
  return applyOverlayScalar(planned, energy, reactiveAmount, cap);
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
  const avail = options.filter((o) => !((cooled[o] ?? 0) > 0));

  // Every option on cooldown: cooldowns already decayed above, so holding
  // one phrase lets them expire instead of violating the restraint.
  if (avail.length === 0) {
    return {
      look: "hold",
      state: {
        phraseCount: state.phraseCount + 1,
        recentLooks: [...state.recentLooks.slice(-3), "hold" as AdaptiveLook],
        cooldowns: { ...cooled, hold: 2 },
        palette: state.palette,
      },
    };
  }

  const n = avail.length;
  const idx = ((Math.trunc(Number.isFinite(seed) ? seed : 0) % n) + n) % n;
  const look = avail[idx] ?? "hold";

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

export * from "./tempo.js";

export * from "./timing.js";

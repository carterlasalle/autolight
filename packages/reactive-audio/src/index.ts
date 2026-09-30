// Live audio may only nudge brightness/sparkle (§69); never strobe/palette/drop.
export const MAX_OVERLAY_GAIN = 0.2; // Fixed cap; now audio.overlay.cap times style.reactiveAmount (T-AUD-03).
export function applyOverlay(planned: number, energy: number, reactiveAmount: number): number {
  const clamped = Math.min(1, Math.max(0, energy)) * Math.min(1, Math.max(0, reactiveAmount));
  return Math.min(1, planned + clamped * MAX_OVERLAY_GAIN);
}

// AGC + rise/decay smoothing (LedFx concepts, independent implementation §68).
export interface AgcState { gain: number; smoothed: number }
export function agcStep(prev: AgcState, input: number, opts: { rise?: number; decay?: number; target?: number } = {}): AgcState {
  const rise = opts.rise ?? 0.3;
  const decay = opts.decay ?? 0.05;
  const target = opts.target ?? 0.5;
  const gain = prev.gain + (target - Math.min(1, input * prev.gain)) * 0.01;
  const smoothed = input > prev.smoothed
    ? prev.smoothed + (input - prev.smoothed) * rise
    : prev.smoothed + (input - prev.smoothed) * decay;
  return { gain: Math.min(4, Math.max(0.25, gain)), smoothed };
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

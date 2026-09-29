import type { DeckState } from "@autolight/contracts";
export type { DeckState };

// State estimator (§57): P + (now - T) * R while playing.
export function estimatePosition(obs: DeckState, nowNs: bigint): number {
  if (!obs.playing) return obs.playheadSeconds;
  const dt = Number(nowNs - obs.receivedAtNs) / 1e9;
  return obs.playheadSeconds + Math.max(0, dt) * obs.playRate;
}

// Seek detection (§58): predicted vs observed beyond threshold.
export function isSeek(predictedSeconds: number, observedSeconds: number, threshold = 0.25): boolean {
  return Math.abs(predictedSeconds - observedSeconds) > threshold;
}

// Audible weight (§63) from faders + play state.
export function audibleWeight(s: DeckState): number {
  if (!s.playing || !s.track) return 0;
  const ch = s.channelFader ?? 1;
  const xf = s.crossfader ?? 1;
  return Math.min(1, Math.max(0, ch * xf));
}

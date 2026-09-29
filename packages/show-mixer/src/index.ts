import { audibleWeight, type DeckState } from "@autolight/dj-core";
import type { ShowCue } from "@autolight/contracts";

// Exclusive impact ownership (§65): highest (weight * strength) wins, never blend.
export function impactOwner(a: { state: DeckState; strength: number }, b: { state: DeckState; strength: number }): "a" | "b" | null {
  const wa = audibleWeight(a.state) * a.strength;
  const wb = audibleWeight(b.state) * b.strength;
  if (wa <= 0 && wb <= 0) return null;
  return wa >= wb ? "a" : "b";
}

// Base-layer blend weights (§64): normalized audible weights; silent decks drop out.
export function baseWeights(a: DeckState, b: DeckState): { a: number; b: number } {
  const wa = audibleWeight(a);
  const wb = audibleWeight(b);
  const total = wa + wb;
  if (total <= 0) return { a: 0, b: 0 };
  return { a: wa / total, b: wb / total };
}
const EXCLUSIVE: Record<string, true> = { blackout: true, "white-hit": true, strobe: true, impact: true };

// Transition-aware blackouts (§66): a full-room blackout on one deck while the
// other is strongly audible becomes a spatial dip, not darkness.
export function translateBlackout(cue: ShowCue, otherWeight: number): ShowCue {
  if (cue.type !== "blackout" || cue.target === "ALL" || otherWeight < 0.3) return cue;
  return { ...cue, type: "dip", target: "SIDE" };
}

// Incoming-deck introduction order (§67): palette → rhythm → impacts, gated by weight.
export function introductionStage(weight: number): "silent" | "palette" | "rhythm" | "impacts" {
  if (weight < 0.05) return "silent";
  if (weight < 0.3) return "palette";
  if (weight < 0.7) return "rhythm";
  return "impacts";
}

export function isExclusive(type: string): boolean {
  return EXCLUSIVE[type] === true;
}

// Track load fast path (§138): cached TrackModel → cached ShowPlan → deck.
// No ML in this path; missing plan compiles from cached features by caller.
export interface LoadedDeck {
  trackJson: string | null;
  planJson: string | null;
}

export function loadFastPath(
  store: {
    loadArtifact(trackId: string, analyzerVersion: string, fingerprint: string): string | null;
    loadShowPlan(trackId: string, styleId: string, plannerVersion: string): string | null;
  },
  trackId: string,
  analyzerVersion: string,
  fingerprint: string,
  styleId: string,
  plannerVersion: string,
): LoadedDeck {
  const trackJson = store.loadArtifact(trackId, analyzerVersion, fingerprint);
  if (!trackJson) return { trackJson: null, planJson: null };
  return { trackJson, planJson: store.loadShowPlan(trackId, styleId, plannerVersion) };
}

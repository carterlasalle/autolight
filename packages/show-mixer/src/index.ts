import { audibleWeight, type DeckState } from "@autolight/dj-core";

// Exclusive impact ownership (§65): highest (weight * strength) wins, never blend.
export function impactOwner(a: { state: DeckState; strength: number }, b: { state: DeckState; strength: number }): "a" | "b" | null {
  const wa = audibleWeight(a.state) * a.strength;
  const wb = audibleWeight(b.state) * b.strength;
  if (wa <= 0 && wb <= 0) return null;
  return wa >= wb ? "a" : "b";
}

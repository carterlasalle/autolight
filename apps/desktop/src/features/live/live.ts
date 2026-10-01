import { rowForTrack } from "../library/library.js";
import type { DeckState, Fixture, TrackModel } from "@autolight/contracts";
import { audibleWeight } from "@autolight/dj-core";
import { mixDown, type DeckMix } from "@autolight/show-mixer";
import { renderFrame } from "@autolight/renderer";
import { applyOverlay } from "@autolight/reactive-audio";

// Live view-model (§89-93): single pure function from deck states + plans +
// fixtures to everything the Live screen renders. Tested, no IPC needed.
export interface LiveViewModel {
  weights: { a: number; b: number };
  owner: "a" | "b" | null;
  upcoming: { startBeat: number; type: string; target: string }[];
  cells: { x: number; color: string }[];
  libraryStatus: ReturnType<typeof rowForTrack>["status"];
}

export function liveViewModel(opts: {
  deckA: DeckState;
  deckB: DeckState;
  mixA: DeckMix;
  mixB: DeckMix;
  beatA: number;
  beatB: number;
  fixtures: Fixture[];
  track: TrackModel | null;
  reactiveEnergy: number;
  reactiveAmount: number;
}): LiveViewModel {
  const { deckA, deckB, mixA, mixB, beatA, beatB, fixtures, track } = opts;
  const mixed = mixDown(mixA, mixB);
  const wa = audibleWeight(deckA);
  const wb = audibleWeight(deckB);
  const beat = wa >= wb ? beatA : beatB;
  const upcoming = mixed.cues
    .filter((c: { startBeat: number; durationBeats: number }) => c.startBeat + c.durationBeats > beat)
    .sort((x: { startBeat: number }, y: { startBeat: number }) => x.startBeat - y.startBeat)
    .slice(0, 5);
  // Per-deck frames blended by audible weight, then reactive overlay
  // (§64, §68: subtle gain only, never structural).
  const fa = renderFrame({ schemaVersion: 1, plannerVersion: "live", trackId: "a", styleId: "live", seed: "live", cues: mixA.cues }, beatA, fixtures);
  const fb = renderFrame({ schemaVersion: 1, plannerVersion: "live", trackId: "b", styleId: "live", seed: "live", cues: mixB.cues }, beatB, fixtures);
  const total = wa + wb || 1;
  const cells: { x: number; color: string }[] = [];
  for (const f of fixtures) {
    const ba = fa.get(f.id);
    const bb = fb.get(f.id);
    if (!ba || !bb) continue;
    f.cells.forEach((c, i) => {
      const chan = (k: number): number => {
        const blended = ((ba[i * 3 + k] ?? 0) * wa + (bb[i * 3 + k] ?? 0) * wb) / total / 255;
        return applyOverlay(blended, opts.reactiveEnergy, opts.reactiveAmount);
      };
      const r = chan(0);
      const g = chan(1);
      const b = chan(2);
      cells.push({
        x: c.position.x,
        color: `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`,
      });
    });
  }
  return {
    weights: { a: wa, b: wb },
    owner: mixed.owner,
    upcoming,
    cells,
    libraryStatus: rowForTrack(track, false, false).status,
  };
}

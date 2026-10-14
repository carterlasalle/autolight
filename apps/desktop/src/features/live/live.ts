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

  // The preview renders exactly what the show composes: mixDown owns cue
  // composition (audible weights, band ownership, overrides), so the frame
  // is rendered from its cues — blending raw per-deck frames bypassed it
  // and blended sRGB bytes (batch-16, F-MIX-04).
  const frame = renderFrame(
    { schemaVersion: 1, plannerVersion: "live", trackId: "live", styleId: "live", seed: "live", cues: mixed.cues },
    beat,
    fixtures,
  );
  const cells: { x: number; color: string }[] = [];

  for (const f of fixtures) {
    const bytes = frame.get(f.id);

    if (!bytes) continue;

    for (const c of f.cells) {
      // Frames are written at the cell's own index, not its array position.
      const base = c.index * 3;
      const chan = (k: number): number => {
        const linear = (bytes[base + k] ?? 0) / 255;

        return applyOverlay(linear, opts.reactiveEnergy, opts.reactiveAmount);
      };

      const r = chan(0);
      const g = chan(1);
      const b = chan(2);
      cells.push({
        x: c.position.x,
        color: `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`,
      });
    }
  }

  return {
    weights: { a: wa, b: wb },
    owner: mixed.owner,
    upcoming,
    cells,
    libraryStatus: rowForTrack(track, false, false).status,
  };
}

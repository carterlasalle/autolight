import type { DeckState } from "@autolight/contracts";

// Deterministic deck-event generator for replay/soak tests (§104, §128).
export function* replay(events: DeckState[]): Generator<DeckState> {
  for (const e of events) yield e;
}

export function makeDeck(over: Partial<DeckState> = {}): DeckState {
  return {
    source: "rekordbox", deckId: 1, track: null, playing: true,
    playheadSeconds: 0, playRate: 1, effectiveBpm: 128,
    loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null },
    channelFader: 1, crossfader: 1, master: true, receivedAtNs: 0n, ...over,
  };
}

// FLX4 telemetry is secondary truth: never overrides DJ playhead (§11).
// Expressive hints only (filter sweep, pad roll, fader rise, loop shrink)
// inform the director, never STROBE().
//
// `CC` and `NOTE` are the legacy channel-blind 7-bit view kept for the hint
// path; their values now match the official list's Data 1 column for each
// control. Deck separation is the MIDI channel, which this view cannot
// express, so deck 1 and deck 2 values are identical here: use
// `decodeMessage` / `FLX4_CONTROLS` in ./map.js for deck-aware events.

export const CC = { CHANNEL_FADER_1: 0x13, CHANNEL_FADER_2: 0x13, CROSSFADER: 0x1f, FILTER_1: 0x17, FILTER_2: 0x18, TEMPO_1: 0x00, TEMPO_2: 0x00 } as const;
export const NOTE = { PLAY_1: 0x0b, PLAY_2: 0x0b, CUE_1: 0x0c, CUE_2: 0x0c, SYNC_1: 0x58, SYNC_2: 0x58 } as const;

export type Flx4Hint =
  | { kind: "fader-rise"; channel: 1 | 2; value: number }
  | { kind: "filter-sweep"; channel: 1 | 2; value: number }
  | { kind: "transport"; control: keyof typeof NOTE; on: boolean };

export function sevenBit(v: number): number {
  return Math.min(1, Math.max(0, v / 127));
}

export function classifyCC(cc: number, value: number): Flx4Hint | null {
  const normalized = sevenBit(value);
  if (cc === CC.CHANNEL_FADER_1) return { kind: "fader-rise", channel: 1, value: normalized };
  if (cc === CC.CHANNEL_FADER_2) return { kind: "fader-rise", channel: 2, value: normalized };
  if (cc === CC.FILTER_1) return { kind: "filter-sweep", channel: 1, value: normalized };
  if (cc === CC.FILTER_2) return { kind: "filter-sweep", channel: 2, value: normalized };
  return null;
}

// Composite provider skeleton (§10): library identity + MIDI transport hints
// + native beatgrid → DeckState estimate. MIDI never sets playhead directly;
// it only confirms faders and transport edges the Lighting provider owns.
export interface CompositeDeckInput {
  deckId: number;
  track: { id: string; rekordboxId?: string; canonicalPath?: string } | null;
  playingHint: boolean;
  channelFader: number | null;
  crossfader: number | null;
  playheadSeconds: number | null;
  playRate: number;
  receivedAtNs: bigint;
}

export function compositeDeckState(input: CompositeDeckInput): {
  deckId: number;
  trackId: string | null;
  playing: boolean;
  channelFader: number | null;
  crossfader: number | null;
  playheadSeconds: number | null;
} {
  return {
    deckId: input.deckId,
    trackId: input.track?.id ?? null,
    playing: input.playingHint,
    channelFader: input.channelFader,
    crossfader: input.crossfader,
    playheadSeconds: input.playheadSeconds,
  };
}

// Fader confirmation (§63, §10): MIDI faders corroborate DJ-software weight
// but never create audibility alone; both sources must agree the deck is live.
export function confirmAudible(midiFader: number | null, djWeight: number): boolean {
  if (midiFader === null) return djWeight > 0;
  return midiFader > 0.02 && djWeight > 0;
}

// Deck-aware map and decoder (T-FLX-02), controller state (T-FLX-03),
// runtime signals (T-FLX-04) and the MIDI backends (T-FLX-01).
export * from "./map.js";
export * from "./state.js";
export * from "./signals.js";
export * from "./backend.js";

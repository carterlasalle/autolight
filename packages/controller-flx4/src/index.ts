// FLX4 telemetry is secondary truth: never overrides DJ playhead (§11).
// Expressive hints only (filter sweep, pad roll, fader rise, loop shrink)
// inform the director, never STROBE().
//
// `CC` and `NOTE` live in ./consts.js, the browser-safe module with no
// node: imports (T-TRU-04 spine fix); this re-export keeps existing
// main-process imports resolving.
export { CC, NOTE } from "./consts.js";

import { CC as CC_VAL, NOTE as NOTE_VAL } from "./consts.js";

export type Flx4Hint =
  | { kind: "fader-rise"; channel: 1 | 2; value: number }
  | { kind: "filter-sweep"; channel: 1 | 2; value: number }
  | { kind: "transport"; control: keyof typeof NOTE_VAL; on: boolean };

export function sevenBit(v: number): number {
  return Math.min(1, Math.max(0, v / 127));
}

export function classifyCC(cc: number, value: number): Flx4Hint | null {
  const normalized = sevenBit(value);

  // The channel-blind 7-bit view cannot separate decks: both channel-fader
  // entries are 0x13 (see ./consts.js). Deck separation needs the MIDI
  // channel via `decodeMessage`/FLX4_CONTROLS in ./map.js, so the bare-CC
  // path reports channel 1 only.
  if (cc === CC_VAL.CHANNEL_FADER_1) return { kind: "fader-rise", channel: 1, value: normalized };

  if (cc === CC_VAL.FILTER_1) return { kind: "filter-sweep", channel: 1, value: normalized };

  if (cc === CC_VAL.FILTER_2) return { kind: "filter-sweep", channel: 2, value: normalized };

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

export interface CompositeDeckEstimate {
  deckId: number;
  trackId: string | null;
  rekordboxId: string | null;
  canonicalPath: string | null;
  playing: boolean;
  channelFader: number | null;
  crossfader: number | null;
  playheadSeconds: number | null;
  playRate: number;
  receivedAtNs: bigint;
}

export function compositeDeckState(input: CompositeDeckInput): CompositeDeckEstimate {
  return {
    deckId: input.deckId,
    trackId: input.track?.id ?? null,
    rekordboxId: input.track?.rekordboxId ?? null,
    canonicalPath: input.track?.canonicalPath ?? null,
    playing: input.playingHint,
    channelFader: input.channelFader,
    crossfader: input.crossfader,
    playheadSeconds: input.playheadSeconds,
    playRate: input.playRate,
    receivedAtNs: input.receivedAtNs,
  };
}

// Fader confirmation (§63, §10): MIDI faders corroborate DJ-software weight
// but never create audibility alone; both sources must agree the deck is live.
// A missing MIDI fader fails over to the DJ weight; a present one must read
// above the physical-up floor. Minimum MIDI-fader level that counts as up.
const MIDI_FADER_UP = 0.02;

export function confirmAudible(midiFader: number | null, djWeight: number): boolean {
  if (midiFader === null) return djWeight > 0;

  return midiFader > MIDI_FADER_UP && djWeight > 0;
}

// Deck-aware map and decoder (T-FLX-02), controller state (T-FLX-03),
// runtime signals (T-FLX-04), MIDI backends (T-FLX-01) and the composite
// feed/wiring seam (T-FLX-06).
export * from "./map.js";

export * from "./state.js";

export * from "./signals.js";

export * from "./backend.js";

export * from "./integration.js";

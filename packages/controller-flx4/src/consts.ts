// FLX4 legacy 7-bit channel constants, browser-safe (T-TRU-04 spine fix).
//
// `CC` and `NOTE` are the legacy channel-blind 7-bit view kept for the hint
// path; their values match the official list's Data 1 column for each
// control. Deck separation is the MIDI channel, which this view cannot
// express, so deck 1 and deck 2 values are identical here: use
// `decodeMessage` / `FLX4_CONTROLS` in ./map.js for deck-aware events.
// No node: imports: tests import this module directly instead of the barrel
// (which re-exports backend.ts with its lazy node:module loader).
export const CC = { CHANNEL_FADER_1: 0x13, CHANNEL_FADER_2: 0x13, CROSSFADER: 0x1f, FILTER_1: 0x17, FILTER_2: 0x18, TEMPO_1: 0x00, TEMPO_2: 0x00 } as const;
export const NOTE = { PLAY_1: 0x0b, PLAY_2: 0x0b, CUE_1: 0x0c, CUE_2: 0x0c, SYNC_1: 0x58, SYNC_2: 0x58 } as const;

# Serato Protocol

Via `chrisle/serato-connect` (MIT) normalized to DeckState (§3.1).

## Sources

- **Disk GEOB** (`packages/serato/src/`, `geob`): reverse-engineered
  BeatGrid (ver 0x01, big-endian f32 position + BPM), verified against
  ScratchBeat fixtures (85 / 88 BPM). Supplies grid/cues.
- **Remote**: Serato Remote Bonjour `_SeratoIOSRemote._tcp` supplies
  transport. Silent with Serato shut (2026-09-29 probe); DeckState replay
  fixtures cover CI (`protocol-fixtures/serato/`).
- **OS2L**: where present, feeds the fusion `os2l` provider
  (`packages/rekordbox-live/src/os2l.ts`).

Frames are built with serato-connect's own codec (`packages/serato/src/
emulator.ts`, `capture.ts`) — never our guess of the protocol; the
emulator drives serato-connect's own test fixtures.

## Normalization

Serato markers → `ProviderDeckState` (`native.serato.grid`,
`native.serato.markers` readiness inputs; `fusion.structure` fallback).
Downstream (planner/runtime) never branches on DJ source.

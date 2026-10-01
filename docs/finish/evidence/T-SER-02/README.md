# T-SER-02: DeckState mapping, master inference, generation and coalescing

Closes F-SER-01, F-SER-04 (wp09-serato.md T-SER-02; spec 3.1; config `serato.master.inferHoldMs` default 750 already in `packages/config/src/registry.ts`).

## What changed

Sources untouched (SeratoM2 owns `packages/serato/src` per Main ruling; they confirmed they will not edit `remoteToDeckState`/`parseBeatGrid`/`tempoRegionsToBeats`/`parseCrate` bodies, and I deleted my draft `mapping.ts` to honor the split). This slice adds tests only:

- `packages/serato/src/mapping.test.ts`: every `SeratoRemoteDeck` field maps into `DeckState` (identity, playhead, rate, effective BPM, play state, loop, both faders, `receivedAtNs`, raw passthrough), per-deck ids 1-4 without cross-talk, null optionals pass through, null filepath maps to null track, stale loop coalesces on track change, re-asserted loop on the same track survives, filepath resolves to `path:<filepath>` TrackId.

## Proof

- `yarn workspace @autolight/serato vitest run src/mapping.test.ts src/geob.test.ts src/serato-dod.test.ts`: 3 files, 31 tests, all green (scoped run this session).
- The null-track test initially failed: it reused the loop-active base fixture without clearing loop fields, so the mapper (correctly) kept the asserted loop. Fix was in the test (send cleared loop fields with the null filepath), not the source. The synthetic-crate test initially failed on UTF-16BE tag bytes; same story, test-side fix.

## Delete test

- Return `crossfader` unmapped (null) and the "maps every reported field" assertion goes red.
- Drop the `trackChanged` coalescing branch in `remoteToDeckState` and the "coalesces stale loop state" test goes red.
- Map null filepath to a non-null track and the null-track test goes red.

## Seams / known gaps (not mine, no source edits allowed)

- Master inference with `inferHoldMs` hysteresis: source always emits `master: null`. SeratoM2's `remote-provider.ts` owns wiring a tracker (ctor takes holdMs, default 750) once transport exposes per-deck weight inputs.
- Generation token: `remoteToDeckState` is stateless and emits no generation; the provider layer (SeratoM2, `DeckGenerationMapper` pattern from `packages/rekordbox-live/src/providers.ts`) owns bump-on-track-change.
- Roll/autoloop channels: current `SeratoRemoteDeck` has no roll fields; loop rolls are covered only as a weak invariant in T-SER-06 item 9 until the transport exposes them.

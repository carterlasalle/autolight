# T-QA-12 Property tests

Closes F-QA-07. Deterministic LCG sweeps, no new dependencies (fast-check/Hypothesis not installed; stdlib sweeps only).

## What changed (new files only, zero edits to existing sources or tests)

- `packages/dj-core/src/beat-mapping.property.test.ts`: grid round-trip on fixed/drifting grids, monotonicity, end clamping, play/pause extrapolation, seek-detector boundary agreement. 5 passed. Type fix: `beatInBar` literal cast; `DeckState` imported from contracts (dj-core re-export is type-only).
- `packages/govee/src/razer-codec.property.test.ts`: arbitrary opcode/payload round-trip, single-bit-flip rejection, short/bad-header/length-lie rejection, arm golden vectors byte-exact, envelope plus `parseDevStatus`/`parseScanReply` shapes. 5 passed. (Package-wide tsc has pre-existing missing-`@types/node` errors also hitting committed tests; my file adds no new error class.)
- `packages/config/src/registry-validation.property.test.ts`: unique dotted keys (incl. `<placeholder>` segments), every default parses to its declared type, unknown keys throw, QA thresholds sane. 3 passed.
- `packages/contracts/src/schema-validation.property.test.ts`: invalid decks/sections/events/coverage rejected with issues, well-formed plan accepted plus bad cue rejected, dropout grid monotone without NaN. 4 passed.
- `packages/show-mixer/src/weights.property.test.ts` (acked by MixerDirector): weights in 0..1, silent decks score zero and own nothing, hard-left/right ownership, incumbent-kept ties, intro stage order. 5 passed.
- `packages/show-runtime/src/seek-equivalence.property.test.ts` (acked by RunAudioM2): loop containment plus pass counting, resume monotonicity on real boundaries (phrase case follows committed T-RUN-07 fallback past the last phrase, flagged by RunAudioM2), model grid reading, cue ordering. 4 passed.
- `packages/venue/src/room-fields.property.test.ts` (acked by RoomM4): unit round-trips, square-room area plus wall consistency, bowtie/short/bad-opening rejection, cell order plus orientation plus resolution. 4 passed. Found and reported two venue defects in RoomM4's new `groups.ts` (stray brace, duplicated len/return lines); RoomM4 fixed, my file then green.
- Planner properties: OBJECTED by PlannerM3 (owns packages/show-planner/src); staged nowhere per agreement, PlannerM3 covers restraint/validator/determinism in-slice. Seam noted, no file created.

## Proof

- Per-package `vitest run <file>`: 5, 5, 3, 4, 5, 4, 4 passed respectively; full `dj-core` (15), `contracts` (6), `govee` (66), `config` (27), `show-mixer` (47), `show-runtime` (37) suites green alongside.
- Shrinking: LCG seeds fixed; any failure reproduces with the seed in the file header comment scope. No failure found to shrink this round.

## Delete test

Delete the bit-flip loop and a broken checksum passes. Delete the tie-hysteresis assertion and an ownership flip goes uncaught. Each file fails on the behavior it guards.

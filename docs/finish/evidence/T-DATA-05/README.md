# T-DATA-05: Semantic validation of contracts

Closes F-DATA-05; wp14 section T-DATA-05.

## What changed

- `packages/storage/src/validation.ts` (new): semantic refinements over the
  contract schemas. `validateBeats` requires beat index and source time
  strictly increasing (unique beats). `validateSections` requires ordered
  ranges plus section cover without gaps or overlaps, bounded by the beat
  range. `validateEvents` requires events inside the beat range with
  non-negative extents. `validateShowPlan` requires positive cue durations.
  `validateFixtureCells` requires unique non-negative cell indexes with
  segment counts consistent between device, calibration and cell map.
  `validateAtBoundary` routes each trust-boundary kind (worker output, DB
  read, IPC input) to its validator. Every rejection carries a precise
  error path (`sections[1].startBeat`, `cues[0].durationBeats`).
- Re-exported from `packages/storage/src/index.ts` alongside the
  `keys.js` line (TrackIdUi coordination kept).

## Proof

- `packages/storage/src/validation.test.ts` (new, 8 tests) over the
  committed `test-fixtures/analysis/live-deck1` TrackModel and ShowPlan:
  fixtures accepted; duplicate beat index rejected at
  `beatGrid.beats[1].index`; unordered range, gap and overlap rejected;
  out-of-range and negative-extent events rejected; zero-duration cue
  rejected; duplicate cell index plus calibration and device count
  disagreements rejected; boundary routing; hash divergence after a fix.
- `yarn workspace @autolight/storage run test`: 10 files, 73 tests passed
  (includes the 5 TrackIdUi keys tests, untouched and green).
- `yarn workspace @autolight/storage run build`: clean.

## Delete test

Delete the strictly-increasing check and the duplicate-index test goes red.
Delete the gap branch and the gap assertion fails. Delete the
`durationBeats > 0` guard and the zero-duration test stops failing. Delete
the whole module and every validation test fails to import.

## Seams

`validateTrackModel` and `validateShowPlan` are the call sites for
T-RUN-08 (fast-path install) and the analysis supervisor (worker output).
`validateFixture` is the call site for venue import and device binding.

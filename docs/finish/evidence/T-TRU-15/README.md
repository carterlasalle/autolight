# T-TRU-15: Replace the fake tests

Closes F-QA-02, F-QA-03, F-PLAN-12, F-LIVE-02.

## What was wrong

- `e2e/night.spec.ts` blackout test was `expect(true).toBe(true)`.
- `packages/govee` stream test was `expect(true).toBe(true)`.
- `packages/show-planner` golden self-wrote when missing.
- `replayFixture` accepted empty captures and echoed expectations.
- `LatestStream.flush()` sent after `close()`; `SegmentStream` lacked `flush`.

## What changed

- night.spec.ts: blackout test now renders a blackout cue through the real
  liveViewModel helper and asserts all 4 cells are `rgb(0,0,0)`. Delete the
  blackout branch in the Live renderer and it goes red.
- govee: stream test asserts close cancels pending plus flush-after-close
  sends nothing. Fixed `LatestStream.close()` to drain the coalescer and
  `flush()` to no-op when closed; added `flush()` to the interface.
- show-planner golden: missing file throws with the `yarn golden:update`
  instruction instead of self-writing. New `scripts/golden-update.mjs` is the
  only writer and appends reasons to `test-fixtures/goldens/CHANGELOG.md`.
  Verified the path writes golden plus CHANGELOG, then reverted.
- rekordbox-live: `capture` requires min length 1 with an `empty capture`
  message; existing 7.2.10 fixtures relabeled honestly as
  `handwritten-synthetic` with `expectedBy` until HW-RB-LIGHT-01 records real
  captures. New test asserts empty capture throws.
- Soak: the soak helper models newest-state-wins drain per tick (by
  design, not a tautology); the accelerated e2e rehearsal renders 864k real
  frames through the Live view model. The wall-clock 4h soak remains T-QA-06.

## Proof

- `yarn workspace @autolight/rekordbox-live test`: 15 passed.
- `yarn workspace @autolight/govee test`: 22 passed.
- `yarn workspace @autolight/show-planner test`: 26 passed.
- `yarn workspace @autolight/desktop test:e2e`: 4 passed (10.1s).
- `yarn build`: clean (caught the missing `flush` on the interface).

## Delete test

Each rewritten test names the code it guards in this README. Revert any fix
and the named test goes red (verified for golden missing-file and empty
capture paths).

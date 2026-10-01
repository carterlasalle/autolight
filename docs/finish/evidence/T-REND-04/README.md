# T-REND-04: Global latency compensation

Closes F-REND-04; probe P-55-latency-global.

## What changed

- No new code: pre-existing `latencyBeats`/`renderWithLatency` in `packages/renderer/src/index.ts` already implements the spec (per-fixture ms converted through deck tempo, whole venue evaluated at the compensated beat, spatial continuity preserved). This slice verified and left it untouched to avoid churning a passing probe owner (T-ARC-04/T-ROOM-08 share it).

## Proof

- Pre-existing `packages/renderer/src/index.test.ts` cases (zero latency equals plain render; 500 ms at 120 BPM shifts exactly one beat; slow/fast fixtures diverge correctly) pass in the green renderer suite (27 tests).
- P-ROOM-02 (seam continuity under a moving head) passes on top of compensated sampling.

## Delete test

Sample every fixture at the uncompensated beat and the slow-fixture assertion goes red.

## Seams

Owned by `index.ts`; spatial motion never sees latency (fields are global).

# T-RUN-01: Deck worlds in the show host

Closes F-APP-02 (with T-ARC-01, T-ARC-04); probes `P-56-ui-freeze`,
`P-62-two-worlds` (spec 62).

## What changed

- `packages/show-runtime/src/index.ts` is the runtime half of the show host:
  `createDeckWorld` (installed `TrackModel`, `ShowPlan`, cursor, estimator,
  loop and scratch state, generation token), `ingestDeck` (latest wins by
  `receivedAtNs`, never a queue, never a block), `installPlan`,
  `installModel`, `tickWorld` and `ShowRuntime` (one world per deck, at most
  four, one tick for all of them).
- The fixed tick order is documented in the module header: ingest, estimate,
  per-deck evaluation, director, mixer, overrides, render, output handoff,
  metrics, snapshot at `runtime.snapshot.uiRateHz`. This package owns ingest,
  estimate, evaluate and override.
- Nothing here runs in React; the renderer process only receives snapshots.
  The React interval and the renderer cursor math (the 0.1 factor, the 0.02
  deck B increment, the first-beat BPM) are gone from the runtime path.

## Proof

- `packages/show-runtime/src/runtime.test.ts`: `P-62-two-worlds` evaluates two
  worlds with different plans and beats independently in one tick; the stale
  observation test proves latest wins; the four world cap throws past
  `MAX_DECKS`.
- Scoped smoke run this session (node type-stripping harness against the
  source, not `yarn`): the two-world and cap checks pass, and the untouched
  `packages/show-host` tick pipeline still publishes snapshots inside
  `runtime.snapshot.maxBytes` with the changed runtime underneath it.
- `P-56-ui-freeze` (renderer paused 5 s, tick jitter p99 under 5 ms) is
  measured by the T-ARC-06 harness with the recording transport; that harness
  drives this runtime.

## Delete test

Delete the `receivedAtNs` comparison in `ingestDeck` and the stale-observation
test goes red (the older state wins). Delete a `MAX_DECKS` check and the cap
test stops throwing. Delete a stage from `tickWorld` (for example the loop
fold) and the corresponding `P-59` test in `packages/show-runtime/src/runtime.test.ts` goes red.

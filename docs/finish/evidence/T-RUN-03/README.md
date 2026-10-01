# T-RUN-03: Seek as random access

Closes F-RUN-01; probe `P-58-seek` (spec 58).

## What changed

- `seekWorld` resets the interpolator, recomputes the fractional beat,
  rebuilds the plan state at that beat as a pure function of the plan
  (`evaluateCues`), cancels the transients of the abandoned location into
  `cancelled`, and returns the new state in the same call. No replay of prior
  cues.
- `tickWorld` turns an estimator seek into the same path, so a hot cue is
  visible in the tick it arrives. Paused hot cues reconstruct state and hold
  it (the estimator holds while paused), they do not freeze the old state.
- Transients are recomputed from the current beat every tick, which is what
  makes the decoration loop-aware in T-RUN-04.

## Proof

- `packages/show-runtime/src/runtime.test.ts`, `P-58-seek`: a hot cue from
  beat 300 to 64 renders the beat-64 state in one tick, drops the in-flight
  white hit and records it in `cancelled`; a paused hot cue reconstructs and
  holds; a property test over a mixed history (seeks, loops, scratch holds)
  shows that rendering at beat b equals a fresh cursor at b for every cue type
  in the plan.
- Scoped smoke run this session: both checks pass against the source.

## Delete test

Remove the `world.cancelled` assignment in `seekWorld` and the abandoned
transient assertion goes red. Stop resetting the estimator on a seek and the
hot cue test keeps the old beat. Make the paused path fall through to the
interpolator and the paused hold test goes red.

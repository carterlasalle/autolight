# T-RUN-05: Reverse and scratch

Closes F-RUN-03; probe `P-61-scratch` (spec 61).

## What changed

- `scratchDetected` uses `runtime.scratch.rateDeviation` for a forward rate
  deviation and `runtime.scratch.minReversalsPerSec` for a jog trace, with the
  FLX4 jog hints as another input to the same state. A steady negative rate
  with no direction reversals is a reverse effect, so it follows the timeline
  backward through the estimator instead of holding.
- SCRATCH HOLD keeps the base look: the cursor holds the held beat with at
  most a quarter beat of gesture modulation, and a jog that moves the deck
  does not jump the design. Once forward playback is stable the cursor resyncs
  at the next `runtime.scratch.resyncAt` boundary (beat, bar or phrase from the
  native grid) and cancels the held transients.
- `trackDeck` keeps the single-deck helper API for callers that track one deck
  by hand, with the same rules and beat-space thresholds.

## Proof

- `packages/show-runtime/src/runtime.test.ts`, `P-61-scratch`: a recorded jog
  trace holds the look (drift at most a quarter beat), resyncs at the next
  native downbeat after forward playback stabilizes, a steady reverse follows
  backward, and a trace with direction reversals enters the hold.
- Scoped smoke run this session: the same trace passes against the source.

## Delete test

Remove the hold branch in `tickWorld` and the held-look assertion goes red.
Drop the `resyncBeat` comparison and the resync test keeps holding. Treat any
negative rate as a scratch again and the reverse-follows-backward test goes
red.

# T-RUN-04: Loops and rolls

Closes F-RUN-02; probes `P-59-loop`, `P-60-roll-degrade` (spec 59, 60).

## What changed

- `tickWorld` folds the cursor into the active loop window with `loopBeat`
  and counts passes. A cue that starts at the loop start is re-evaluated from
  the folded beat on every pass, so a hit fires each pass, not once.
- Pass variation follows `runtime.loop.variation`: `loopPassVariant` maps the
  pass to a deterministic variant (none, alternate A and B, rotate three) and
  `varyCueForPass` applies it while keeping the cue type and start beat, and
  therefore its palette reference and motif identity, untouched.
- Tiny loops and rolls degrade by the fixture's qualified rate:
  `rollDegradeChoice` compares the roll's toggle rate with the fixture fps and
  returns the first entry of `runtime.roll.degradeOrder` when the fixture
  cannot sample every toggle, instead of strobing irregularly.

## Proof

- `packages/show-runtime/src/runtime.test.ts`, `P-59-loop`: three passes over
  a four-beat loop give passes 0, 1, 2 with the same folded beat, the loop
  start hit in every pass, pass 2 identical to pass 0 (A, B, A) and pass 1
  varied with the identity fields preserved.
- Same file, `P-60-roll-degrade`: a 1/16 roll at 120 BPM degrades on a 20 Hz
  fixture and plays in full on a 60 Hz fixture; the degrade order is taken in
  order and is configurable.
- Scoped smoke run this session: both checks pass against the source. The
  frame-level A/B/A hash difference is asserted at the cue-set level here and
  rendered by `packages/renderer/src/layers.test.ts`.

## Delete test

Make `loopPassVariant` always return 0 and the A, B, A shape assertion goes
red. Make `varyCueForPass` return the cue unchanged and pass 1 stops differing
from pass 0. Make `rollDegradeChoice` always return `full` and the 20 Hz roll
test goes red.

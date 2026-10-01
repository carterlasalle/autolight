# T-PLAN-08: Recurrence and motif memory

Closes F-PLAN-05; probe `P-2.6, P-37`.

## What changed

- `src/recurrence.ts`: kind-gated similarity (energy 0.5, hue 0.3, length 0.2) against `similarityThreshold`; sections above threshold share a motif id; `MotifMap` records base look plus per-occurrence variation (direction alternates, secondary colour from occurrence 2, density ramp, primary/secondary fixtures, accent timing); dissimilar kinds score 0 and never share; motif-return beats feed the colour gate.
- Compile alternates repeat-section targets by occurrence so returns are recognizable, not identical.

## Proof

- `src/recurrence.test.ts`: returning chorus reuses the motif id with forward/reverse directions, different fixtures and different targets; breakdown and verse never join the chorus motif.
- Red run observed: hue followed the section index, so repeats compared distant (`motif-2` vs `motif-4`); hue now follows the section kind.

## Delete test

Zero the threshold with the kind gate removed and the dissimilar-sections case goes red (verse would join chorus). Remove the alternation and the target-difference case goes red.

## Seams

Threshold is `planner.recurrence.similarityThreshold`. Returns justify colour changes (T-PLAN-02).

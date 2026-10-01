# T-ANA-14: Numeric correctness fixes

Closes F-ANA-19.

## What changed

- `features.silence_probability` is clamped to [0, 1]: the old input
  `frame_rms = 0.005` with threshold 0.01 returned 1.5 and now returns 1.0;
  the ramp is unchanged below the clamp.
- `features.beat_aggregate` divides a trailing partial group by its real
  size, not the full group size.
- Property-style checks use stdlib loops (Hypothesis is not a dependency and
  pyproject is owned by the T-ANA-17 slice).

## Proof

- `uv run pytest tests/test_features.py -q`: clamp regression plus the
  partial-group mean case, alongside the existing aggregate tests.

## Delete test

Remove the `min/max` clamp and the 0.005 regression fails; divide by the
full group size and the partial-group test fails.

## Seams

- Bug Corpus entries for both defects are not created here (corpus is outside
  this slice's target paths); the failing-capable tests stand in.

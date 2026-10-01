# T-PLAN-10: Validator and evaluator in production

Closes F-PLAN-10; probe `P-114, P-115`.

## What changed

- `src/validate.ts`: `validateCompiledPlan` runs on every compile (unknown primitives, negative durations, out-of-range cues, level-table violations, overlapping exclusives, non-finite positions, venue-unsupported capabilities, repeated unjustified white impacts inside `whiteHitMinBeats`, palette-identity changes faster than `paletteChangeMinBeats`); `evaluateCompiledPlan` computes all ten spec 115 diagnostics; `diagnosticsOutOfBounds` rejects pathological generations against `evaluationBounds` so the next candidate wins.
- Validator accepts an injected `knownTypes` so the RoomM4 registry stays the authority.

## Proof

- `src/validator.test.ts`: clean compile has zero problems; one failing example each for overlapping exclusives, negative duration, out-of-range cue, unknown primitive, level violation, unsupported capability; all ten diagnostics numeric; a tightened bound flags the generation.

## Delete test

Remove any single check and its failing-example case goes red. Narrow the white-hit bound below the plan value and the bounds case goes red.

## Seams

Scoring veto consumes bounds failures (T-PLAN-12). Pinned edit cues bypass restraint but never the validator.

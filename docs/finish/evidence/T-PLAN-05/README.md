# T-PLAN-05: Restraint engine

Closes F-PLAN-07, F-PLAN-15, F-APP-12; probe `P-34, P-78`.

## What changed

- `src/restraint.ts`: all 11 spec 34 fields plus blinder usage; `restrain` accepts, substitutes (white hit inside the gap becomes a full-colour impact; close blackout becomes a dip; over-repeated pattern varies) or rejects (strobe duty, style with strobes off) with a recorded reason; thresholds are config, gap is raw `whiteHitMinBeats`; `requestBlinder` fires only on phrase boundaries inside budget and counts the hit so it cannot vanish.
- Every compile candidate passes through restraint; verdicts land in `rejected` or the cue `reason`. Same engine instance shape serves live decisions.

## Proof

- `src/restraint.test.ts`: the spec example (white hit 4 beats after the last becomes an impact); blinder on/off-boundary/budget cases; property loop over gaps 1/2/4/8/15 (all substitute) with acceptance exactly at the configured gap; compile-level gap proof with named substitution reasons; EDM strobes within duty.
- Red run observed: message said `4 beats` numerically and the spec-worded assertion failed; reason now reads `N beats after the last one`.

## Delete test

Set the gap to 0 and the property loop goes red. Bypass restraint for white hits and the compile gap proof goes red. Remove the duty check and the strobe-budget case goes red.

## Seams

Live path uses a runtime instance of the same engine (adaptive director, FLX4 hints). Manual blinder control is restraint-aware (F-APP-12).

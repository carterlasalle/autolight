# T-PLAN-12: Candidate scoring hook (DS-19)

Closes F-PLAN-14; probe `P-113`.

## What changed

- `src/scoring.ts`: `rules` (first candidate, deterministic), `scored` (per-section candidates picked by registered evaluators), `rules-with-veto` default (rules stand unless a candidate is pathological: empty, all-dark, or saturated-without-variation, then the next clean candidate wins). Evaluators are pure named functions; built-ins are density, darkness-balance, contrast and diagnostics; `registerEvaluator` adds a learned evaluator later without touching the planner.
- Compile builds `candidatesPerSection` variants per section, records vetoed candidates in `rejected`, and scales section energy by the winning variant so scoring visibly moves the plan. No Skip-BART/SeqLight code, weights or data anywhere (spec 112).

## Proof

- `src/scoring.test.ts`: rules ignores evaluators deterministically; scored follows a dummy evaluator deterministically; veto replaces an empty winner and records it; a late-registered learned evaluator decides without planner changes.

## Delete test

Make veto blind and the replacement case goes red. Make scoring use `Math.random` and the determinism cases go red. Remove the energy scaling and winners stop moving the plan (caught by the styles direction suite).

## Seams

Bounds failures from T-PLAN-10 feed the veto path. Default mode stays `rules-with-veto` per the registry.

# T-PLAN-14: Compile performance and caching

Closes spec 138; probe `p95 budget`.

## What changed

- `src/cache.ts`: `PlanCache` keyed by the five determinism inputs (fingerprint, planner version, style, venue, config hashes) with hit/miss stats; `spliceSection` swaps one section range for incremental recompile, preserving order outside the range.
- Measured on this machine (see `benchmark.json`): single-track compile and repeat-hit cache behavior; budget is `planner.compile.budgetMs` (2000 ms p95).

## Proof

- `src/cache.test.ts`: five-input keying (style change misses), hit/miss stats, splice preserves outside cues, compile completes inside the budget.
- Scoped run: planner suite green; benchmark written by direct measurement, not estimation.

## Delete test

Drop `styleHash` from the key and the keying case goes red (a style change would serve a stale plan). Break splice ordering and the splice case goes red.

## Seams

Plan artifacts version by planner version; TrackModel reuse across planner bumps is T-DATA-03.

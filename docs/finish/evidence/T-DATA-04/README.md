# T-DATA-04: Fast path loader

Closes F-DATA-04, F-RUN-09; probe `P-138-fast-path`.

## What changed

- `packages/storage/src/fastpath.ts` (new): `loadFastPath(store, request)`
  resolves a track load to parsed and validated objects:
  1. the artifact row is looked up by its full key (track, schema version,
     analyzer version, config hash, source fingerprint);
  2. the artifact file named by that row is read and parsed with
     `trackModelSchema`;
  3. the plan row is looked up by the plan cache key and parsed with
     `showPlanSchema`, and its `trackId` and `styleId` must match the request,
     so a plan from another track is refused rather than installed;
  4. results are kept in a 32 entry LRU (`clearFastPathCache`, `resetFastPath`,
     `fastPathCacheSize`) and every load is timed.
- Misses are typed: `no-artifact`, `invalid-artifact`, `no-plan`, `invalid-plan`,
  each with a detail string. A missing plan still returns the TrackModel, which
  is what lets the caller compile from cached features (spec 138 step 2).
- `fastPathTimings()` reports p50, p95, p99 and max over a 512 sample window
  and `fastPathBudget(budgetMs)` is the blocked check against
  `runtime.fastPath.budgetMs`.
- The F-DATA-04 bug is closed at the API level: the artifact path is a database
  column, never a return value. An unreadable artifact is an `invalid-artifact`
  miss, which the regression test pins (`typeof result.track` is not `string`).

## Proof

- `packages/storage/src/fastpath.test.ts` (new, 8 tests) over the committed
  `test-fixtures/analysis/live-deck1` TrackModel and ShowPlan: parsed objects,
  the F-DATA-04 regression, a JSON object that is not a TrackModel, the LRU
  proof, typed misses, an unparseable plan row, a plan key mismatch, and the
  p95 budget run.
- The LRU proof deletes the artifact file after the first load and asserts the
  second load still returns the track and plan from memory with
  `cacheHit: true`, so the cache is doing the work and not a second file read.
- Measured on this machine (Apple M1 Pro, node 22.22.2, node:sqlite driver):
  150 cold loads land at p50 0.3 to 0.4 ms and p95 0.6 to 0.7 ms against the
  `runtime.fastPath.budgetMs` budget of 100 ms (the run that printed
  `P-138: 150 cold loads, p50 0.36 ms, p95 0.71 ms, p99 1.25 ms, max 6.53 ms,
  budget 100 ms`). Each load is cold (the cache is cleared, so the file read
  and the zod parse are included) and the numbers come from the loader's own
  timings, not from the test harness.
- `node_modules/.bin/vitest run --silent=false --reporter=verbose` from
  `packages/storage`: 7 files, 46 tests passed.
- Simulator runs prove code, never hardware; no hardware claim is made here.

## Delete test

Delete the `readFileSync` plus `trackModelSchema.parse` and return
`artifact.artifact_path` instead, and the F-DATA-04 regression test fails on
`typeof result.track === "string"`, which is exactly the old bug. Delete the
`plan.trackId !== request.trackId` guard and the plan-mismatch test stops
failing. Delete the LRU map writes and the second load in the LRU test goes
red after the file is removed (and `fastPathCacheSize()` drops to 0). Delete
`recordTiming` and the p95 budget test reports zero samples and fails. Delete
`clearFastPathCache` and the cold-load run becomes a warm run, so the reported
p95 no longer measures the load path.

## Remaining work (not claimed done)

- The app-side call site is `T-RUN-08`: the deck load handler should call
  `loadFastPath` with the resolved identity, and T-RUN-08 owns the phrase
  upgrade path and its own measurement of P-138 end to end (load event to
  installed plan). This slice proves the loader and its timing surface.
- `runtime.fastPath.budgetMs` is read by the caller; the loader takes the
  budget as an argument so the config value is not duplicated in code.

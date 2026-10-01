# T-QA-01 Every test class exists and is enforced

Closes spec 126; probe P-126-classes.

## What changed

- `tools/qa/check-classes.mjs` (new): walks `packages/`, `apps/desktop/e2e|journeys|src|electron`, `analysis/tests`; classifies each test file (property by `*.property.test.ts`, goldens by `*golden*`, desktop E2E by `e2e/*.spec.ts` plus `journeys/*.journey.ts`, replay/simulator/fault by filename, perf/soak/schema likewise, rest unit); fails when any of the 12 spec 126 classes has zero files; checks the required-suite artifacts (T-QA-05 `measurement.json`, T-QA-06 `soak-report.json`, T-QA-03 README, `normal-night.spec.ts`, T-ANA-16 README, planner golden JSON, T-REND-06 README, T-QA-04 README for both simulator and fault classes); prints the unique test count (S18).
- Fault-injection class cites SecFaultDocs scope: `apps/desktop/electron/services/fault-injection.ts` plus its test (APPROVED-TO-CITE by Main).

## Proof

- `node tools/qa/check-classes.mjs` today prints 12 classes with counts (unit ~124, schema 3, property 7, protocol-replay 1, planner golden 1, renderer golden 1, device simulator 3, fault injection 2, desktop E2E 5, performance 1) and MISSING only for suites owned by other slices: analysis golden (T-ANA-16), soak report full run (T-QA-06 nightly), T-REND-06 README. Exit 1 while any class or required suite is missing, which is the failing-capable behavior.
- Unique test files printed (S18): 146.

## Delete test

Delete any `*.property.test.ts` and the property count drops; remove the last file of a class and the checker exits 1 naming the class. Delete `normal-night.spec.ts` and the desktop E2E required-suite check fails.

## Seams

- Analysis-golden and renderer-golden file ownership sits with AnalysisM3/PlannerM3 and the renderer slice; the checker counts their committed files read-only.
- Wiring into CI (`T-TRU-11`) is that task's step; the script is the gate logic.

# T-QA-10 Goldens everywhere, updated deliberately

Closes F-QA-04; probes P-127-goldens, P-129-no-self-write.

## What changed

- `tools/qa/check-goldens.mjs` (new): scans test sources for `writeFile` calls targeting `test-fixtures` or `*golden*` (temp-dir writes excluded); fails on any hit, enforcing that `yarn golden:update --reason` is the only writer (S2). Reports the `test-fixtures/goldens/CHANGELOG.md` presence.

## Proof

- `node tools/qa/check-goldens.mjs`: clean, no self-writes; changelog MISSING noted as owned by T-ANA-16 (not a policy violation yet).
- Failing-capable: add a `writeFileSync` of a golden path inside any `*.test.ts` and the check names the file and line.

## Delete test

Delete the temp-dir exclusion and legitimate fixture-copying tests false-positive; delete the scan and golden self-writes go uncaught.

## Seams

- The `test-fixtures/goldens/CHANGELOG.md` dir plus analysis-golden suite land with T-ANA-16 (AnalysisM3 slice); planner golden already exists and passes.
- CI wiring of this check next to the T-TRU-06 `no-golden-self-write` ast-grep rule is the `T-TRU-11` step.

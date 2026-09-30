# T-DOC-03: CONTRIBUTING and AGENTS alignment

Closes F-DOC-06.

## What changed

- CONTRIBUTING now describes the real practices: 12 test layers by file
  naming, journeys path (`journeys/*.journey.ts`, never `e2e/*.spec.ts`),
  evidence folders with red plus green runs, `yarn golden:update` as the only
  golden writer, non-empty captures with `expectedBy`, `yarn truth` plus
  `yarn verify:all`, Bug Corpus IDs, and the no-em-dash rule.
- AGENTS.md done under T-TRU-13 (scars S1-S28, runnable canonical commands,
  memory sections); this task verifies the two documents agree.

## Proof

- Steps executed: `yarn truth` green (five gates), `yarn verify:all` path
  components verified individually (build clean, typecheck zero errors,
  vitest 47 files 232 tests, pytest 46 plus 2 skipped, e2e 4 passed).
- `node docs/finish/tools/check-coverage.mjs`: OK (STATUS discipline the
  CONTRIBUTING describes is mechanically checked).

## Delete test

Revert the journeys path sentence and a new `e2e/*.spec.ts` crashes Vitest
again with no doc warning against it.

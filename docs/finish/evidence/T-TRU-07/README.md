# T-TRU-07: Vitest configuration and coverage

Closes F-QA-01, F-QA-08, F-QA-14 (coverage part).

## What was wrong (S18)

- One workspace config collected compiled `dist` tests: 214 executions for
  about 111 unique tests (source plus `dist` copies).
- Playwright `test()` calls in `e2e/*.spec.ts` crashed the Vitest runner
  (3 failed suites, 0 failed tests).

## What changed

- `vitest.workspace.ts`: every package plus desktop as workspace projects.
- Per-package `vitest.config.ts` (20 files): `include: src/**/*.test.ts`,
  `exclude: dist/**`. Desktop additionally excludes `journeys/**`.
- Playwright journeys moved `e2e/*.spec.ts` to `journeys/*.journey.ts` with
  `testMatch: **/*.journey.ts`, so Vitest's default `**/*.spec.ts` glob can
  never collect them even without the exclude.
- `@vitest/coverage-v8` added as a root devDep for the per-package coverage
  gates (thresholds enforced per package in CI follow-up, T-TRU-11).
- Root `yarn test:count` script prints unique test count per run.

## Proof

- `yarn vitest run`: 47 files passed, 232 tests passed, 0 failed suites.
  Before: 50 files (3 Playwright crashes), 232 tests.
- `yarn workspace @autolight/desktop test:e2e`: 4 passed (journeys still run).
- `find packages apps -name *.test.js -path *dist*` still lists compiled
  copies on disk, but the runner no longer collects them (file count proves it).

## Coverage thresholds (ratchet, not yet blocking)

AGENTS.md gates (line 85, branch 80, function 90, statements 85; new code 95
and 90; critical packages 95 line, 90 branch) are enforced per package once
T-TRU-11 wires coverage into CI. Any package below threshold gets listed in
STATUS.md with its raising task. Lowering a threshold needs an entry in
`threshold-changes.md` with owner approval (file created when first needed).

## Delete test

Delete any per-package `vitest.config.ts` and `dist` tests get collected
again (file count rises). Rename a journey back to `.spec.ts` under a scanned
dir and the runner crashes on it.

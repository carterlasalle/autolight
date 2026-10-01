# T-TRU-11: CI pipeline rewrite

Closes F-OPS-08, F-QA-06 (partial), F-QA-14 (staged CI), spec 84, 85.

## What changed

- `.github/workflows/ci.yml` (rewritten): 16 jobs, every stage its own job,
  `uv sync --project analysis --frozen --all-groups` for every Python step,
  no `uvx` anywhere. Stages: format (ruff format check; TS formatter not
  configured, so the check names the missing owner visibly), lint (ESLint
  config missing check owned by T-TRU-06, plus ruff), types (tsc per
  workspace, pyright), dead-code (Knip plus Vulture via `uv run --with`),
  architecture (dependency-cruiser), truth (`yarn truth`), unit-coverage
  (Vitest with the T-TRU-07 thresholds, pytest with coverage, test count),
  mutation-fast (Stryker on changed TS packages in scope plus the
  critical-list check plus mutmut on changed Python modules), replay
  (rekordbox-live plus serato decoder suites; full harness pending T-QA-03),
  integration (show-host suite plus analysis worker; app-level suite pending
  T-QA-04), e2e (Playwright with `AUTOLIGHT_TEST_BUILD=1`, macOS plus Windows
  plus ubuntu with xvfb, Playwright chromium install), conformance
  (capability manifest check, claim check, probe report pending T-QA-01),
  licenses (uv overlay pip-licenses plus the license checker), security-codeql
  (init plus autobuild plus analyze), package and smoke-install (fail visibly
  naming T-OPS-05 and T-OPS-06).
- `.github/workflows/nightly.yml` (new): schedule plus manual dispatch.
  mutation-full (Stryker across all nine modules, mutmut full, critical-list
  check), fuzz (fails visibly naming T-QA-12), timing (harness check naming
  T-QA-05), soak (fails visibly naming T-QA-06).

## Proof

- `node -e` YAML parse of both files: `ci` parses with 16 jobs, every
  required stage name present (format, lint, types, dead-code, architecture,
  truth, unit-coverage, mutation-fast, replay, integration, e2e, conformance,
  licenses, security-codeql, package, smoke-install); `nightly` parses with 4
  jobs (mutation-full, fuzz, timing, soak); zero `uvx` invocations in either
  file; `uv sync --project analysis --frozen --all-groups` present in every
  Python job.
- Stages whose subject does not exist yet fail visibly and name the task
  that turns them green: package (T-OPS-05), smoke-install (T-OPS-06), soak
  (T-QA-06), fuzz (T-QA-12), timing (T-QA-05), ESLint config (T-TRU-06),
  probe report (T-QA-01), replay harness (T-QA-03), integration suite
  (T-QA-04), critical-list pendings (T-BLE-04).

## Delete test

Remove a stage job from `ci.yml` and the required-stages check names it
(the parse probe above lists any missing name). Remove `uv sync --frozen
--all-groups` from a Python job and the sync-form probe fails. The
missing-subject steps are ordinary `exit 1` shells, so deleting them turns
their jobs green, which is itself the signal that the subject landed and the
step must be replaced by the real run.

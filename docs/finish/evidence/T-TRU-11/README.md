# T-TRU-11: CI pipeline rewrite

Closes F-OPS-08, F-QA-06 (partial), F-QA-14 (staged CI), spec 84, 85.

## What changed

- `.github/workflows/ci.yml`: 16 staged jobs, fail fast via needs chains:
  format, lint, types, dead-code (Knip), architecture (depcruiser), truth
  (`yarn truth`), unit-coverage (Vitest plus pytest with AGENTS.md gates),
  mutation-fast (Stryker changed packages plus mutmut plus critical-list
  check), replay (fixture lint today, full T-QA-03 harness pending),
  integration, E2E (macOS plus Windows, Linux xvfb extra), conformance
  (manifest plus matrix probes), package, smoke-install. Python steps use
  `uv sync --frozen --all-groups`.
- `.github/workflows/nightly.yml`: full mutation, fuzzing, timing harness,
  4h SIM soak on schedule plus manual dispatch.
- Stages with no subject yet fail visibly naming the owner: replay names
  T-QA-03, package and smoke-install name T-OPS-05/T-OPS-06, soak names
  T-QA-06. A fully green pipeline is required by the acceptance release
  checklist, not by this M0 task.

## Proof

- Both workflow files parse as valid YAML with every stage present
  (checked with PyYAML in this session).
- `mutation-fast` references `tools/mutation/check-critical.mjs`, which
  exits 1 today on the two T-BLE-04 pending entries: the stage is honestly
  red until M2, exactly as the task requires.

## Delete test

Delete any job and the stage list no longer matches the task's stage
enumeration. Silence a pending stage instead of failing visibly and the
DoD's red-run requirement goes red.

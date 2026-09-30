# T-TRU-01: Coverage tool and status discipline in CI

Closes F-DOC-06 (process part).

## What changed

- `yarn truth` (alias `yarn audit:truth`) runs: plan coverage tool,
  capability manifest check, claim check, forbidden-words check, ast-grep
  scan. CI will run it as a required job (T-TRU-11 wires the workflow).
- STATUS.md discipline: every task row carries status plus evidence; the
  coverage tool fails on missing tasks, phantom rows, invalid statuses,
  DONE-VERIFIED without README, and every other check in its header.

## Proof

- `yarn truth` output (this session):
  - check-coverage: OK (227 tasks, 273 findings, 36 decision switches,
    189 probes, 30 runbooks, 240 config keys)
  - capabilities-check: OK (19 capabilities, 0 PASS)
  - claim-check: OK
  - forbidden-words: clean
  - ast-grep: 0 errors, 28 warnings
- Removing a task line from STATUS.md makes the tool fail (demonstrated
  during development: task count drops and the findings check names the
  orphaned finding).

## Remaining work (not claimed done)

- CI workflow wiring (T-TRU-11): truth as a required job on every push.

# T-QA-11 Gates and the Rekordbox definition of done

Closes F-QA-06; probes P-120-rekordbox-dod, gates 152 A-H.

## What changed

- `apps/desktop/e2e/normal-night.spec.ts` (new): the 17 rows of 99-final-acceptance.md section 3 as `test.step` blocks against the built app in Simulator mode via the T-QA-02 harness. Red by design until T-ARC-01/T-GOV-14 land; each row fails at the `normal-night-row` test channel until then. HW version is `HW-NIGHT-01`.
- `tools/gates/gates.mjs` (new) plus root `yarn gates` script (single added line in package.json; no other script/dep edits): maps gates A-H and the 18 spec 120 items to probes and evidence READMEs, prints PASS/FAIL/MISSING per item and per gate, exits 1 on any MISSING.
- Playwright config untouched (journeys runner already serial); the e2e spec is picked up by the same `test:e2e` command.

## Proof

- `node tools/gates/gates.mjs`: all gates MISSING today with exact missing-task names (T-QA-07, T-ANA-16, T-QA-09, T-QA-10, T-QA-13, T-QA-11, T-QA-08, T-OPS-05/06 evidence), exit 1. As each slice lands its evidence README, its gate flips to PASS with no gate-code change.
- `git diff package.json` is the single `gates` script line (serato-connect yarn.lock change belongs to SeratoM2).

## Delete test

Delete an evidence README and its gate flips back to MISSING. Remove the `normal-night-row` channel wiring and all 17 rows go red.

## Seams / runbooks

- `normal-night.spec.ts` green three nights on SIM plus `HW-NIGHT-01` report remain; nightly wiring is `T-TRU-11`.
- Spec 120 items 17/18 (macOS plus Windows Rekordbox suites incl. AX provider or documented UNAVAILABLE) are proven by the Rekordbox slices; this gate only reads their evidence.

# T-ROOM-04: Strip mapping wizard

Closes F-ROOM-01, F-ROOM-03, F-VEN-05, spec 42, 43, 52 steps 9 to 11.

## What changed

- `packages/venue/src/wizard.ts` (new): 10-step logic without hardware coupling. Direction answer classifies single vs split; mirror check counts lit places (2 means `split-mirrored` with the consequence note and symmetric set offer); bisection helper; gap-aware piecewise-linear fit; verify offset suggestion; `runWizardOnSim` drives a SIM strip with hidden truth through a virtual user.
- UI steps live in `apps/desktop/src/routes/venue/mapping-wizard.tsx` (T-ROOM-03).

## Proof

- `packages/venue/src/wizard.test.ts`: hidden 30-cell SIM mapping recovered within one cell; mirrored SIM classified with orbits disabled and SymmetricSweep offered; verify offset detection.
- Venue suite green.

## Delete test

Make `mirrorCheck(2)` return single and the mirrored test goes red. Drop gap subtraction and a gapped SIM fit drifts past one cell.

## Seams

Writes `CellMap` anchors/gaps (T-ROOM-02); calibration persistence is a T-ROOM-11 record keyed by device and venue. HW runbook (owner ceiling video) is out of scope for SIM.

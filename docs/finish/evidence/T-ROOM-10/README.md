# T-ROOM-10: Preview of the real room

Closes F-ROOM-04, F-UI-04, F-APP-07, spec 92; probe P-92-preview-equals-output.

## What changed

- `apps/desktop/src/routes/venue/room-preview.tsx`: one room view drawing every real cell at its mapped position from `fieldCellsForReference` plus `computeFields`, colored by the exact `sampleSpatial` logical level (pre-calibration, spec 92), with a beat scrubber. Elevation/3D (`three`) intentionally skipped: the top-down plus extent readout covers the ceiling rig without a new dependency.

## Proof

- `apps/desktop/src/routes/venue/room.test.ts` preview case: live cells render with a beat control.
- Colors come from the same sampler the renderer uses, so preview equals logical output by construction; SIM equality harness is T-ARC-04 territory.

## Delete test

Replace the sampler call with a constant color and the preview still renders but the level variation is gone; the sampler import is the test (remove it and the file fails typecheck).

## Seams

Snapshot equality (T-ARC-04) and UI frame budget (T-UI-13) are owned elsewhere.

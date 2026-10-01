# T-PLAN-15: Planner goldens and regression

Closes F-PLAN-12; probe `P-129`.

## What changed

- Golden covers the reference track plus renderer frame hashes at key beats via the committed `planner-golden.json`; the legacy-shape golden is regenerated only through `yarn golden:update --reason`, which versions the planner (`0.2.0`) and appends to `test-fixtures/goldens/CHANGELOG.md`.
- This wave's deliberate change (full v2 compiler, legacy shape preserved) was recorded with a reason; mixer/renderer/pipeline consumers still compile against the legacy shape (show-mixer pipeline test plans the real track, validates and renders).
- `test-fixtures/analysis/real-track-1.trackmodel.json` (18 sections, 586-beat grid) compiles to a stable plan: same five inputs give byte-identical output (schema.test determinism).

## Proof

- `src/golden.test.ts`: missing golden fails with the update instruction (no self-write); committed golden matches byte for byte after the deliberate update.
- `red-run.txt`: golden deleted, test fails; golden restored, test passes (captured this session).

## Delete test

The red run is the delete test: delete the golden and the suite goes red by design; Landing an unreasoned golden diff violates the task contract.

## Seams

Golden writer ownership: `scripts/golden-update.mjs` is the sole writer (T-TRU-15, T-QA-10). Planted-event coverage lives in the per-task unit tests above.

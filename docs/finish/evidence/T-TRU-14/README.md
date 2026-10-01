# T-TRU-14: Delete dead and duplicate code after replacement

Closes F-REND-09, F-GOV-19, scar S10 (partial, scoped to owned paths).

## What changed

1. `packages/renderer/src/index.ts`: removed unused `createHash` import from `node:crypto`. No other line touched. Replacement pointer: `frameHash` in the same file uses FNV-1a hex so the show worker runs the same code as tests with no Node crypto dependency.
2. `analysis/src/autolight_analysis/fusion.py`: removed duplicate `def grid_warning`. Added re-export `from autolight_analysis.metrical import grid_warning as grid_warning` so existing `fusion.grid_warning` references keep working. Replacement pointer: canonical definition is `analysis/src/autolight_analysis/metrical.py:grid_warning`. Production caller `analysis/src/autolight_analysis/worker.py` already imports from `metrical`.
3. `analysis/tests/test_fusion.py`: updated import only. `fuse, build_track_model` still come from `fusion`; `grid_warning` now comes from `metrical`. No test logic changed.
4. `packages/govee/src/index.ts`: removed the unverified `Lightwave order` fragment from the transport contract comment and replaced the `H6076 is single-zone over LAN (community-confirmed)` comment with a neutral pointer stating single-zone fallback is owned by T-GOV-10 and decided per unit by probe. Function `collapseToSingleColor` itself is kept because T-GOV-10 owns its deletion (see `docs/finish/evidence/T-GOV-14/README.md`). Its only production caller `apps/desktop/electron/govee-lan.ts:frameToLan` is outside owned paths and untouched.
5. `jscpd.json` (new): threshold 5, TypeScript plus Python, paths `packages/*/src/**/*.ts` and `analysis/src/**/*.py`, ignores `dist`, `node_modules`, `*.test.ts`, fixtures, and `.bughunt`. Suggested npm script (not added, `package.json` edits are out of scope): `jscpd --config jscpd.json`.

## Explicitly not deleted in this slice

- `latencyBeats` in `packages/govee/src/index.ts`: kept. Deleting it would break `packages/govee/src/index.test.ts` which is outside owned paths, and there are no callers inside govee to fix. Renderer copy in `packages/renderer/src/index.ts` is kept as the primary. A later task owning the govee test file should dedupe to one import.
- `collapseToSingleColor` function body: kept per above; only the unverified default claim went.
- `frameToLan`, `show-service.ts`, `follow.ts`, `govee-lan.ts`, renderer latency sections: untouched; later tasks own those deletions.

## Knip-clean reasoning (by inspection)

- `createHash`: grep over `packages/renderer/src` shows zero uses after import removal; `frameHash` and `latencyBeats` exports are still imported by `packages/renderer/src/index.test.ts`, `packages/show-host/src/index.ts`, `packages/show-mixer/src/pipeline.test.ts`, and `apps/desktop/src/renderer/live.ts`, so no export was orphaned.
- `fusion.grid_warning`: no live importer used `fusion.grid_warning` (only `worker.py` uses `metrical.grid_warning` and tests used `fusion.grid_warning`). The re-export keeps backward compatibility, so Knip sees `metrical.grid_warning` as used by both `fusion.py` and `worker.py`, and `fusion` exports `fuse, build_track_model, grid_warning` all still imported by tests.
- `packages/govee/src/index.ts`: no export removed, only comment text changed, so the Knip export graph is unchanged. `collapseToSingleColor` remains imported by `apps/desktop/electron/govee-lan.ts` and the govee test, so no dangling reference was created.

## Proof

- Scoped import check ran with `analysis/src` on path: `fusion.grid_warning is metrical.grid_warning`, plus disagreement cases `[0.0] vs [0.01]` false, `[0.0] vs [0.2]` true, empty input false. Simulator runs prove code only and never qualify hardware.
- Text checks: no `createHash` in renderer, no `Lightwave` or `community-confirmed` in `packages/govee/src`, `collapseToSingleColor` and both `latencyBeats` copies present, `jscpd.json` threshold 5.
- Orchestrator runs project-wide gates; no yarn install, build, typecheck, test, lint, or formatter was run in this slice per contract.

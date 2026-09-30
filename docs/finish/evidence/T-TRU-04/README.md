# T-TRU-04: Reachability and architecture gates

Closes F-QA-14 (Knip, dependency-cruiser), scar S8, spec 155.

## Knip baseline (2026-09-30)

`knip.json` with entries at main, preload, renderer shell, and every package
index. First run on current code:

- 17 unused files (5 electron entries flagged because esbuild bundles outside
  Knip's graph plus 12 shadcn UI leaves), 14 unused dependencies, 10 unused
  devDependencies, 26 unused exports.
- Recorded as the ratchet start: counts may never grow
  (`tools/ratchet.json` extended below). Each later task deletes its dead
  code (T-TRU-14) until zero, when the rule turns blocking.

## dependency-cruiser (3 rules, CI error)

- `renderer-no-show-internals` (S7): renderer may not reach show-runtime,
  show-mixer, renderer, or govee. RED today: the Live view model imports
  `@autolight/show-mixer` and `@autolight/renderer` (2 violations above).
  This is the F-APP-02 spine violation: the show loop lives in React.
  Turns green with T-ARC-01 plus T-REND-01 (show host owns time and output,
  renderer observes snapshots).
- `renderer-no-simulator` (S3): green today (T-TRU-02 removed the imports).
- `planner-no-device-internals` (venue independence): green today.

## Proof

- `yarn knip` output saved (counts above).
- `yarn depcruise --config .dependency-cruiser.cjs packages
  apps/desktop/src apps/desktop/electron`: 2 errors, both the known renderer
  spine violation.

## Ratchet

`tools/ratchet.json` gains `knip` and `depcruiser` sections with today's
counts. The M1 exit requires the renderer rule at zero (show host exists).

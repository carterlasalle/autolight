# T-RUN-08: Track load fast path, prepared-show upgrade and style handover

Closes F-APP-03, F-APP-11, F-RUN-08, F-RUN-09. Probes P-138-fast-path,
P-140-upgrade-boundary. Spec 138, 140.

## What was wrong

No live-track-without-prepared-show handling and no clean upgrade at a
phrase boundary; `loadFastPath` returned an artifact path as `trackJson`;
the planner recompiled both tracks every 250 ms in React and a style switch
applied mid-playback with no handover.

## What changed

- `packages/show-runtime/src/fastpath.ts` (new): `loadGeneration` resolves
  identity (T-RBL-07), fetches cached TrackModel plus ShowPlan through the
  storage fast path (parsed objects, never a path string), installs into the
  deck world. Missing plan with a model present installs STRUCTURED and
  calls `compileNow`; nothing cached queues top-priority analysis and holds
  ADAPTIVE. `upgradeAtBoundary` parks better plans, style changes and
  planner edits at the next phrase (default), section or bar boundary;
  `installUpgrade` applies the decided plan on the boundary tick. No ML on
  this path. `index.ts` untouched (runtime owner confirmed no overlap).
- `packages/show-runtime/src/fastpath.test.ts` (new): cached install as
  objects within `runtime.fastPath.budgetMs`, missing-plan compile path,
  missing-everything analyze path, phrase parking, boundary install.

## Proof

- `yarn workspace @autolight/show-runtime test src/fastpath.test.ts`:
  4 passed. Load event to installed plan under 100 ms budget (asserted on
  `totalMs`; cold file read plus zod parse included via the storage
  loader).
- Failing-capable: return the artifact path and the `typeof track`
  assertion goes red (F-RUN-09 regression pinned); install upgrades
  immediately and the parking test resolves mid-phrase; skip `compileNow`
  and the missing-plan test never compiles.

## Delete test

Delete `src/fastpath.ts` and the block fails to import. Delete the
`DELETE FROM show_plans` plus `clearFastPathCache` isolation and the
missing-plan test passes on a stale LRU hit. Delete the boundary filter
and upgrades land at the current beat.

## Seams

- Storage T-DATA-04 owns the loader and P-138 timings; this slice owns the
  generation handler and the boundary policy.
- Style handover is the same boundary path with the new style plan as the
  proposal; planner edits arrive as upgrade proposals.

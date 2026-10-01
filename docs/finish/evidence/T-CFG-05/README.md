# T-CFG-05: Settings UI

Closes F-UI-17, F-CFG-02 (visibility part).

## What changed

- New Settings screen (`settings-view.tsx`): sidebar entry under System plus
  route, search by key/unit/receipt, group badges (type, scope, receipt,
  live-safe vs restart-safe), default value per row, changed-only filter.
- Lists all 240 registry keys (first 200 rendered, search refines).
- Layer badges and per-scope editing plus import/export buttons remain for
  T-CFG-02 (persistence); this task proves visibility of every key.

## Proof

- `yarn workspace @autolight/desktop typecheck`: zero errors.
- `yarn workspace @autolight/desktop test`: 8 passed.
- Settings route renders from the real `KEYS` array, not a static list:
  delete a key from the catalog and the on-screen count drops.

## Delete test

Delete the Settings route and the sidebar has no Settings entry; delete the
`KEYS` import and the view goes red at typecheck.

## This slice: diff plus live-safety helpers (data/security/ops support)

- `packages/config/src/compare.ts` (new, shared with T-CFG-07):
  `compareKeys` diffs two config snapshots (effective vs default, or
  before vs after an import) for the Settings diff indicator and the
  "show only changed" filter. Sorted by key; JSON-compared values. The
  same module's `planLiveChange` supplies the live-safe marker each row
  renders.
- Proof: `packages/config/src/compare.test.ts` (3 tests);
  `yarn workspace @autolight/config exec vitest run src/compare.test.ts`:
  3 passed.
- Delete test: delete `compareKeys` and the diff test fails to import;
  return all keys instead of changed ones and the equality assertion fails.

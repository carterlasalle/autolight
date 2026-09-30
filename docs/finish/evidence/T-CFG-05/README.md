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

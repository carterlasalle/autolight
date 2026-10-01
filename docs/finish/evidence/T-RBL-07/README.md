# T-RBL-07: Live deck to library to cached model resolution

Closes F-APP-03 (resolution part). Spec 12, DS-22.

## What was wrong

No provider to identity to cache resolution existed: the track a deck played
could not be resolved to a cached model, so the Live screen showed fixture
tracks. The composite row carried `canonicalPath` while `rowToIdentity`
read `filePath`.

## What changed

- `packages/rekordbox-library/src/identity.ts` (new): `resolveLiveTrack`
  over the DS-22 chain (`memory-reader-id`, `lighting-ipc-id`, `agent-api`,
  `history-table`, `title-path`), each step reporting confidence and which
  step matched. ID steps consult the library row first so the alias graph
  sees path and hash; the title step only matches a unique candidate and
  reports `ambiguous title` otherwise, never resolving by title alone.
- `src/index.ts`: re-export `service.js` restored (my first edit replaced it
  instead of adding alongside; caught by the index test, fixed same turn)
  plus the new identity module line.
- `packages/rekordbox-library/src/identity.test.ts` (new): chain order,
  memory-reader priority, lighting/agent/history links, ANLZ path and unique
  title resolution, ambiguous-title refusal.

## Proof

- `yarn workspace @autolight/rekordbox-library test`: 11 files, 65 passed,
  1 skipped (identity block: 5 passed).
- Failing-capable: reorder the chain and the order test goes red; resolve
  ambiguous titles and the refusal test resolves two tracks to one ID;
  delete the history-table guard and an ID absent from history resolves.

## Delete test

Delete `src/identity.ts` and the identity block fails to import. Restore
title-only resolution and the ambiguous test names the regression.

## Seams

- T-RUN-08 consumes `resolveLiveTrack` on every new generation; the
  Diagnostics Track Resolver tab (T-UI-10, UiScreens) renders `steps`.
- Composite provider shape (`packages/rekordbox-live`) is the caller input;
  CompositeFlx6 owns that file.

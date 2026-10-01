# T-ID-03: Key the UI and cache by TrackId

Closes F-ID-03. Spec 12 (TrackId durable across rename, move, retag; never
title-based). wp06 section T-ID-03.

## What was wrong

Two halves of the keying story. The cache rows were already keyed by
`track_id` (`packages/storage/src/cache.ts`), but there was no validation
point rejecting title keys and no per-track UI-state container, so nothing
stopped a caller from keying by title. In the renderer,
  `apps/desktop/src/features/library/library-view.tsx` builds row ids from
  the deck A title field and `inspector-view.tsx` matches the selected track by
comparing titles, so two tracks sharing a title collide and a retag drops
selection and inspector state.

## What changed (this slice only)

- `packages/storage/src/keys.ts` (new, imported as `./keys.js`; no change
  to `index.ts` exports):
  `normalizeTrackId` (trims, throws on empty instead of falling back to
  title), `TrackStateMap<V>` (selection/scroll/draft state keyed by
  TrackId; `retain()` prunes only tracks gone from the library, never on
  rename), `uniqueTrackLabels` (same-title rows get distinct display
  labels; React keys stay the TrackIds).
- `apps/desktop/src/routes/library/track-key.ts` (new): renderer-safe
  mirror (`libraryRowKey`, `isSelectedTrack`, `libraryRowLabels`). It
  mirrors instead of importing `@autolight/storage` because the storage
  entry pulls in node sqlite, which the Vite renderer bundle cannot load;
  the rule (trim, reject empty, compare TrackIds) is identical.
- Tests: `packages/storage/src/keys.test.ts` (5 tests), `apps/desktop/src/routes/library/track-key.test.ts` (4 tests).

Not touched: `features/library/*` and `features/inspector/*` views belong
to the UiScreens slice; the helpers above are the seam it adopts (it
confirmed it will reuse them once landed). The `track_id` columns in
`cache.ts` already satisfy the cache half; `keys.test.ts` proves each
same-title track gets its own plan row.

## Proof

- `yarn workspace @autolight/storage vitest run src/keys.test.ts`: 5 passed.
- `yarn vitest run src/routes/library/track-key.test.ts` in `apps/desktop`: 4 passed.
- Failing-capable: `normalizeTrackId("")` throws; same-title labels test
  fails if labels are keyed by title (both rows map to one key); cache
  test fails if `loadShowPlan` ignores `track_id`.

## Delete test

Delete `packages/storage/src/keys.ts` and `keys.test.ts` fails to import.
Delete `routes/library/track-key.ts` and `track-key.test.ts` fails to import.
Reintroduce title-keyed rows in a view and the `isSelectedTrack`
same-title test names the regression to write.

## Seams / hand-offs

- UiScreens: adopt `libraryRowKey` as the React key and `isSelectedTrack`
  for Inspector matching in `features/library/library-view.tsx` and
  `features/inspector/inspector-view.tsx`; use `libraryRowLabels` for the
  DoD case of two fixture tracks sharing a title.
- T-ID-01 (IdentityFastPath): `TrackStateMap.retain` expects the library
  track list; wire it to the alias-graph track enumeration when it lands.

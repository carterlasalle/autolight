# T-UI-02: Live screen

Closes F-UI-03, F-UI-04, F-UI-05, F-UI-15. Spec 89/90/93 (wp13-ui.md T-UI-02).

## What changed

- New `apps/desktop/src/routes/live/live-fields.ts`: pure derivation of the
  spec 90 deck fields (title, artist, source, play state, playhead, native and
  effective BPM, pitch, beat, bar, phrase, section, next event, fader, audible
  weight via `audibleWeight`, analysis quality via `coverageOf`, artwork null)
  plus `predictiveLabel` (drops beat breakdowns beat builds, P-90) and
  `nextPhraseBeat` for style/blinder boundaries.
- `apps/desktop/src/routes/live/live-fields.test.ts`: fields from snapshot
  data, missing data labelled not guessed, DROP IN 8 at beat 32 with the drop
  at 40, drop-over-breakdown precedence.
- `features/live/live-view.tsx`: style picker now lists the seven planner
  style ids (`BUILT_IN_STYLES` keys) with a visible pending state that lands
  at the next phrase boundary (see T-UI-14); `MasterControls` shows the real
  store intensity instead of null.
- `app/store.ts`: `overridesIntensity`, `liveBeat`, `pendingStyle`.
- `app/resolve-live.ts`: cursor records `liveBeat` and clears `pendingStyle`
  into `style` at the next 32-beat boundary.

## Proof

- `yarn vitest run` (owned files): 15 files, 83 passed, including
  `live-fields.test.ts` (4 rows) and the routes/screens/component suites.
- Full renderer run: 94 passed, 1 failed in RoomM4's room geometry test
  (expects "Save mapping"; peer-owned, untouched).
- Typecheck: zero errors in UiScreens files (remaining 32 errors all in
  RoomM4 `routes/venue/room-*.tsx` and LiveSetupAssist
  `features/setup/rkbx-setup-panel.tsx`, verified by file grouping).

## Delete test

- Delete `predictiveLabel`'s drop branch and the P-90 row ("DROP IN 8") goes
  red; delete the live beat write in the resolve-live module and pending styles
  never land.

## Seams

- `live-fields.ts` reads `DeckState`/`TrackModel`/`ShowPlan` only; screens
  bind snapshots to it. RoomM4 owns `routes/venue/` room editor files;
  TrackIdUi owns `routes/library/track-key.ts`.

# T-UI-05: Library screen, readiness and the preanalysis queue

Closes F-UI-06, F-UI-16. Spec 95/137/139 (wp13-ui.md T-UI-05).

## What changed

- New `apps/desktop/src/routes/library/library-rows.ts`: `libraryTrackRow`
  covers every spec column (track, artist, BPM, key, duration, native grid,
  native structure, deep analysis, show, last modified) plus the six statuses
  READY / ANALYZING / NEEDS ANALYSIS / GRID WARNING / SOURCE MISSING / FAILED
  with `failReason`. Readiness reuses `coverageOf` (structured or full is
  READY). Queue helpers: `queueEntry`, `advanceQueue` (Queued, Analyzing,
  Compiling, Ready, Failed with progress), `prioritiseQueue`,
  `dropFromQueue`. `upcomingForDecks` labels per-deck cues with deck-local
  beats (P-93).
- `features/library/library-view.tsx`: searchable/sortable table (search
  input; virtualization is T-UI-13's list work), rows keyed by TrackId via
  TrackIdUi's `routes/library/track-key.ts` (`libraryRowKey`, never title),
  per-row Queue button, preanalysis panel with Queued count, Priority,
  Cancel, Retry, Remove per entry.
- No parallel TrackId helper: confirmed with TrackIdUi/Main, single helper
  reused.

## Proof

- `library-rows.test.ts` (3 rows): all six statuses incl. FAILED reason;
  queue Queued, Analyzing, priority reorder, Failed with reason, remove;
  P-93 deck 1 at beat 32 labels "in 8 beats", deck 2 at beat 100 past the cue
  yields nothing.
- 10,000-row 60fps scroll is T-UI-13's trace; this task proves grading plus
  queue transitions. Owned run: 15 files, 83 passed.

## Delete test

- Swap `coverageOf` for a constant `true` and the NEEDS ANALYSIS row goes
  red; drop the `prioritiseQueue` reorder and the priority row goes red.

## Seams

- `routes/library/` holds `track-key.ts` (TrackIdUi), `library-rows.ts` plus
  tests (UiScreens). No screen changes from TrackIdUi; no UiScreens key
  helper. Persistence across restarts is the analysis supervisor's queue
  (T-ANA-02); the screen holds session state.

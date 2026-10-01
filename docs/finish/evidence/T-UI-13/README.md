# T-UI-13: UI performance with real data volumes

Spec 88/117 UI part (wp13-ui.md T-UI-13).

## What changed

- Snapshot path already throttled and diffed: `useLiveCursor` ticks at 4Hz
  (250ms) and writes one `live` object; screens bind, components never time.
- `FixturePreview` renders one svg per fixture row with rects (never a div
  per cell); `Waveform` renders one polyline plus one playhead line;
  `upcomingForDecks` slices to 5 per deck; Settings renders 200 rows per
  group with search to refine (grouped, so the 200 cap applies per group,
  not globally); Library table is search-filtered.
- `withinFrameBudget` pins the bar: p95 under 16.7ms at 60fps.

## Proof

- `simulator-mode.test.ts` budget rows: 12ms passes, 16.7 and 20 fail.
- Reference-Mac/Windows traces with 2,000 cells plus two decks are the
  orchestrator's phase-end measurement; this task proves the render shapes
  (svg rows, single polyline, sliced cues, capped lists) plus the budget
  predicate. Owned run: 15 files, 83 passed.

## Delete test

- Raise the budget to 30ms and the 20ms row passes (predicate is the bar);
  render one div per cell and the trace (not the unit run) blows the budget.

## Seams

- Virtualized 10,000-row library plus cached waveform tiles: recorded gaps;
  the table is capped by search, not yet windowed. No new dependency (no
  react-virtual use added; it stays available).

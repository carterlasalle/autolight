# T-UI-10: Diagnostics and the DJ Event Inspector

Closes F-UI-11, F-GOV-26 (UI). Spec 101/102/111 (wp13-ui.md T-UI-10).

## What changed

- New `apps/desktop/src/routes/diagnostics/diagnostics-model.ts`:
  `DIAGNOSTIC_TABS` names all ten spec tabs (DJ Events, Transport, Beat
  Clock, Track Resolver, Analysis, Planner, Renderer, Fixtures, Latency,
  Logs); `isFresh` (2s staleness), `djEventRow` (timestamp, source, deck,
  event, recordToNdjson true).
- `features/diagnostics/diagnostics-view.tsx`: renders all ten tabs (was
  nine, Track Resolver added), appends a rolling 20-row DJ event list on the
  DJ Events tab with "record to .ndjson" per row, stale badge when the last
  `diagnostics/all` read ages out. Values come from `diagnostics/all`
  only; no forced metrics.

## Proof

- `diagnostics-model.test.ts`: ten tabs, fresh/stale/null boundaries, ndjson
  flag true.
- Diagnostics suite plus owned run: 15 files, 83 passed. Live changing
  values per tab (P-101) and ndjson replay into the simulator (P-102) need
  the running app; the tab that was missing (Track Resolver) now renders.

## Delete test

- Remove "Track Resolver" from `DIAGNOSTIC_TABS` and the ten-tab row goes
  red; default `recordToNdjson` false and the ndjson row goes red.

## Seams

- Tab values are owned by T-OPS-03 metrics plus each pipeline slice; this
  slice owns tab names, freshness, and event rows. Recording to disk is the
  session recorder (T-DATA-06), flagged here.

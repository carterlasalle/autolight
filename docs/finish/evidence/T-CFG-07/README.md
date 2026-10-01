# T-CFG-07: Live-mode change safety

Spec 140/144 part (03-config-and-decisions.md T-CFG-07).

## What changed

- `apps/desktop/src/routes/diagnostics/diagnostics-model.ts`:
  `routeConfigChange` (no Live: apply-now; Live plus live-safe: apply-at-bar;
  Live plus unsafe: queue-until-live-ends) plus `drainPendingQueue`.
- `features/settings/settings-view.tsx`: Set routes through
  `routeConfigChange`; unsafe edits while Live is active land in a visible
  "Pending until Live ends: N" list with an Apply-pending button that shows
  only when Live ends (`live === null`); live-safe edits send `config/set`
  immediately for next-bar application.
- The canonical planner (`planLiveChange`/`queueLiveChange`/
  `drainLiveQueue` in `@autolight/config` compare.js, exported from the
  dist) owns the key-level policy; the UI helper mirrors its three outcomes
  without duplicating the registry read. No show-host change: the host
  already applies live-safe keys at boundaries and holds unsafe ones.

## Proof

- `diagnostics-model.test.ts` routing rows: live-safe under Live goes to
  bar, unsafe queues, idle applies now, drain returns the queued key.
- Runtime no-discontinuity test (live-safe planner key mid-phrase, frames
  hold within one tick) plus queued-unsafe E2E are the orchestrator's
  phase-end pass; routing plus the pending list are this task's proof.
- Owned run: 15 files, 83 passed.

## Delete test

- Route unsafe Live edits to apply-now and the queue row goes red; hide the
  pending list and queued edits vanish silently (the visible-list assertion
  is the E2E half).

## Seams

- Show-host frame continuity is T-RUN-08/T-REND-04; config persistence is
  T-CFG-02. This slice owns routing plus the pending UI.

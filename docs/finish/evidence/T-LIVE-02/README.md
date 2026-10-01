# T-LIVE-02: Provider manager and the fusion provider (DS-01)

Closes F-LIVE-14, F-APP-08. Probe P-7-priority (probe file:
`packages/rekordbox-live/src/manager.test.ts`, the path matrix row 7 names).

## What changed

- `packages/rekordbox-live/src/fusion.ts`:
  - `FusionEngine` ranks field authority per field with the DS-01 default order
    (`lighting-ipc`, `memory-cleanroom`, `rkbx-osc`, `prolink`,
    `composite-flx4`, `ax`, `os2l`, matching `live.fusion.authority`), takes each
    field from the highest-ranked provider whose value is fresh
    (`live.provider.staleMs`) and whose quality is not stale, fills
    `fieldSources` and `quality` on every emitted state, and labels a holder
    that went silent as `stale` instead of dropping or inventing the field.
  - Hysteresis: a challenger only takes a field after it has been continuously
    fresh for `live.fusion.switchHoldMs`; `live.fusion.disagreeBeats` raises a
    cross-validation diagnostic for playhead and BPM disagreements.
  - Every authority change is a `FusionSwitchEvent` (field, from, to, reason,
    timestamp) and is counted per provider; `refresh()` re-evaluates freshness
    against the clock so a silent provider shows as stale without new input.
  - `LatestWinsPort` is the bounded, latest-wins-per-deck forwarding port;
    `ProviderManager` starts the enabled providers, supervises them with restart
    backoff (budget, status text via `describe()`) and forwards fused state.
- `packages/rekordbox-live/src/manager.test.ts` (P-7-priority): Lighting wins
  while fresh, Composite takes over after `live.provider.staleMs` plus the
  switch hold, then the last value stays labelled stale with no new authority.
- `packages/rekordbox-live/src/fusion.test.ts`: default ranking, per-field
  labels, hysteresis against a single late packet, stale takeover, the
  disagreement diagnostic appearing and clearing, latest-wins forwarding and
  manager restart supervision including budget exhaustion.

Not in this slice: the Electron wiring (config service, IPC port, Settings page
and status bar badge) belongs to the main-process work; `ProviderManager`,
`FusionEngine` and the event stream are the parts it consumes.

## Proof

Observed with `node --experimental-strip-types` against the real modules:

- Hysteresis: a challenger that goes silent never flips the field; a challenger
  that stays fresh for less than the hold window does not flip; after the hold
  the switch event carries reason `higher-authority` (holder fresh) or
  `stale-takeover` (holder stale).
- Disagreement: `rkbx-osc` at 10.0 s and `prolink` at 10.5 s at 128 BPM raise one
  diagnostic with spread 1.07 beats against the 0.25 threshold; aligning them
  clears it.
- Manager: a provider that fails to start is restarted through the injected
  scheduler and reports a non-failed status afterwards; with the restart budget
  exhausted it reports `failed` with `restart budget exhausted`.
- Scoped type check of the package: 0 diagnostics.

The orchestrator runs `yarn workspace @autolight/rekordbox-live test` for the
vitest form. The Playwright part of this task (Settings switches `live.provider`
at runtime, status bar shows the new source) needs the main-process wiring and
stays with that work.

## Delete test

Delete the pending-challenger bookkeeping in `FusionEngine.pick` and the
hysteresis test in `fusion.test.ts` goes red (the field flips on the first
challenger packet). Delete `LatestWinsPort.drainPending` keeping only the latest
entry and the latest-wins test goes red. Delete the `restart` call in
`ProviderManager` and the restart supervision tests go red.

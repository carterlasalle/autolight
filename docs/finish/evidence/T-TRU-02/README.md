# T-TRU-02: Fixture data out of production, Simulator mode explicit

Closes F-APP-03, F-APP-07, F-UI-19.

## What was wrong

- `apps/desktop/vite.config.ts` set `publicDir` to `test-fixtures`, so the
  built app served `live-homecoming.*` and `live-deck2.*` as live data.
- `resolve-live.ts` fetched those files and hardcoded both decks
  `playing: true`, faders at 1.0, plus `makeFixture("left",14)` preview.
- `inspector-view.tsx` fetched the same fixture files.
- `show/live` returned `{ live: null }`.

## What changed

- Deleted `publicDir` from `vite.config.ts` (default `public/`, which is empty).
- `resolve-live.ts` now reads DeckState plus installed TrackModel and ShowPlan
  from the show host over `show/live` IPC. No `fetch`, no fixture names, no
  `makeDeck` or `makeFixture` in production code. Empty decks produce empty states.
- `inspector-view.tsx` loads the installed TrackModel from the same IPC surface.
- Added explicit Simulator mode: `simulatorMode` in the shell store, a
  persistent SIMULATOR badge in the titlebar, a SIM toggle that sends
  `simulator/mode` IPC. Same production pipeline, simulated sources and sinks.
- Live screen already shows honest empty states (`No show loaded`) when
  `live` is null.

## Proof

- `grep -rn "@autolight/simulator" apps/desktop/src apps/desktop/electron`
  returns nothing outside tests.
- `grep -rn "live-homecoming|live-deck2|./analysis/"` in the same dirs
  returns nothing.
- Fresh `yarn workspace @autolight/desktop build`, then
  `grep -rl "live-homecoming" apps/desktop/dist/` exits 1 (clean).
- `yarn workspace @autolight/desktop typecheck` passes with no errors.

## Delete test

Delete the new `show/live` response shape and both `resolveLiveDecks` and
`useLiveCursor` go red: they have no other data source. Delete the SIMULATOR
badge and the mode toggle has no visible surface.

## Remaining work (not claimed done)

- `show/live` still needs the real show host backing (T-ARC-01, T-RUN-01,
  T-RBL-07): DeckState from the provider manager, TrackModel and ShowPlan
  from the cache. The IPC surface shape is defined here so the host can fill it.
- `simulator/mode` needs its main-process handler (provider manager plus
  loopback Govee sim, T-GOV-14). The renderer toggle and badge exist.
- dependency-cruiser forbidden rule plus CI bundle scan (T-TRU-04, T-TRU-11).

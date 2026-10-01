# T-UI-04: Manual lane for performance

Closes F-UI-01, F-UI-18, F-APP-12 (UI), F-APP-19 (UI). Spec 88 (wp13-ui.md T-UI-04).

## What changed

- New `apps/desktop/src/routes/live/manual-intents.ts`: every manual control
  names its typed IPC channel and payload (`show/energy`, `show/trigger-build`
  at the next phrase beat, `show/trigger-drop`, `venue/set-color` with the
  custom flag, `master/intensity` clamped to 0.5..2, flash on/off). Track
  palette derives from section kinds (gold for drop/chorus, ND blue for
  breakdown/verse, white fallback), deduped in order.
- `features/live/live-view.tsx` ControlGrid: "party" styling gone. Style card
  lists the seven spec styles; palette card shows the track palette with free
  colour behind an explicit Custom switch; Build fires at
  `nextPhraseBeat(liveBeat)`; spatial target A/B/Both radios; sensitivity
  slider sends `master/intensity`; alternating A/B pattern and speed send
  `show/energy` with alternate/pattern/speedMs.
- Every control shows its state from the store snapshot (`s.manual`,
  `s.target`, `s.sensitivity`, `s.altOn`, ...).

## Proof

- `manual-intents.test.ts` (3 rows): every channel exists in `@autolight/ipc`
  (phantom intent goes red), blinder carries the phrase beat, custom flag
  passes through, sensitivity clamps to 2, palette has 2 entries for a
  chorus+verse track and none without a track.
- Owned run: 15 files, 83 passed.

## Delete test

- Remove `custom: true` from the custom-swatch invoke and the custom-flag row
  goes red; point Build at `{ version: 1 }` without `at` and the blinder row
  goes red.

## Seams

- `manual-intents.ts` is channel names plus payloads only; the screen binds
  them via the existing string `invoke` (no new string-ipc sites beyond the
  rule's function-declaration scope). `show/correction` is NOT added here.

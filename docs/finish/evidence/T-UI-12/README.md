# T-UI-12: Accessibility, ergonomics and the no-modal guard

Closes F-UI-12, F-UI-13. Spec 143/144 (wp13-ui.md T-UI-12).

## What changed

- `apps/desktop/src/routes/settings/simulator-mode.ts`:
  `routeDialogDuringLive` (live-active dialogs route to status, idle shows)
  next to the existing `isModalAllowed` in `app/shortcuts.ts` (both return
  false/route-to-status under Live; two names, one rule, both pinned).
- No new modals: grep over `features/` shows the only dialog is the
  command palette (`CommandDialog`); no Live action (BLACKOUT, FULL WHITE,
  FREEZE, AUTO/MANUAL, style, venue switch) confirms inline or modal.
- Type floor: Live timing text renders at `text-5xl` (48px floor,
  `ui.live.minTimingFontPx`), body at 13px+ with the catalog floor at 16px
  (`ui.live.minBodyFontPx`) recorded as the tightening gap; semantic colors
  always pair with text labels (`StatusDot` requires `label`).

## Proof

- `simulator-mode.test.ts` modal row: `routeDialogDuringLive(true)` routes
  to status, false shows; `isModalAllowed` mirrors both.
- axe-core zero-serious plus owner distance review plus injected-failure
  E2E (analysis failure, device loss, update notice during Live with B/W/F/A
  at the recording transport inside P-94) need the built app; the guard
  helpers plus the no-dialog grep are this task's unit proof.
- Owned run: 15 files, 83 passed.

## Delete test

- Flip `routeDialogDuringLive(true)` to show-dialog and the guard row goes
  red; add a `confirm()` to any Live intent and the no-modal grep fails.

## Seams

- Owner distance review note lands in this dir after the review; the screen
  already meets the 44px critical-target floor via `size-7`+ padded buttons
  except swatches, which are non-critical.

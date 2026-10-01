# T-UI-14: Styles in the UI

Closes F-APP-11 (UI), F-APP-18 (UI). P-135 (wp13-ui.md T-UI-14).

## What changed

- Style picker lists the seven planner ids from `BUILT_IN_STYLES`
  (club, house, festival, lounge, pop, dark, minimal); custom styles send
  `custom: true` on `show/style` (palette card's Custom switch; planner
  custom-style compile is T-PLAN-09).
- `pendingStyle` in the store plus the "Pending {style}: applies at the next
  phrase boundary" line: style changes during playback land at the next
  32-beat boundary in `resolve-live.ts` (boundary handover, T-RUN-08's
  runtime half applies the compiled plan).
- All 11 style properties: the planner `ShowStyle` carries five
  (intensityRange, darknessPreference, reactiveAmount, whiteHitFrequency,
  strobeFrequency); the remaining six are T-PLAN-09's editor surface and are
  recorded as the gap, not faked here.

## Proof

- Owned run: 15 files, 83 passed; routes test renders Live with the style
  card.
- Mid-track switch plus boundary-handover E2E (P-135 shape) needs the
  running app; the pending line plus cursor handover are this task's proof.

## Delete test

- Remove the boundary check in `resolve-live.ts` and pending styles apply
  instantly (handover row would go red once the E2E pins it); restrict the
  picker to four names and the seven-style row goes red.

## Seams

- Style editor with previews in the Inspector: T-PLAN-09. This slice owns
  picker, pending state, and boundary timing.

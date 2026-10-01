# T-UI-03: Emergency controls and shortcuts

Closes F-UI-02, F-APP-17. Spec 94 (wp13-ui.md T-UI-03).

## What changed

- `apps/desktop/src/components/command-palette.tsx`: the Emergency group
  used to be two close-only items (F-APP-17: Blackout and Freeze only called
  `setOpen(false)`). All four items now fire the same typed intents as the
  shortcut keys through `invoke`: Blackout (B) to `master/blackout`, Full
  white (W) to `master/full`, Freeze (F) to `master/freeze` with
  `{ frozen: true }`, Resume auto (A) to `master/resume` with `{ at: "bar" }`.
- `apps/desktop/src/app/shortcuts.ts`: the map holds exactly the four
  implemented emergency channels (`b/w/f/a`). Intents without a typed
  channel yet (manual lane, intensity steps, presets, Space) stay out so no
  key silently does nothing; the file says so.
- `apps/desktop/src/components/kit.test.ts`: regression block "emergency
  controls (T-UI-03)" pinning the four map entries and asserting every map
  value names a real channel in `@autolight/ipc` (a phantom intent turns the
  row red; deleting a map entry turns the first row red).

## Proof

- `yarn workspace @autolight/desktop test`: 9 files, 62 passed (60 before
  plus the 2 UI-03 rows).
- `yarn workspace @autolight/desktop typecheck`: zero errors.
- The four channels are all inside the T-TRU-03 30/30 side-effect matrix,
  so keypress and palette paths share dispatch coverage.
- Shell wiring unchanged and already correct: keys work outside text inputs
  (`shell.tsx` skips INPUT/TEXTAREA), no modal anywhere (`isModalAllowed`
  returns false in Live).

## Delete test

- Revert the palette Emergency items to `setOpen(false)` and no test fires
  intents anymore (the shortcut-map test still passes, which is why the
  palette fix itself is the deliverable, not the test).
- Delete `w: "master/full"` from SHORTCUTS and the map-object row goes red.
- Add `"1": "master/preset-1"` and the implemented-channels row goes red.

## Not claimed (P-94 latency)

- Keypress-to-UDP-send p99 under 100 ms needs the E2E harness against the
  built app with the recording transport (M1 slice step 9). The unit rows
  prove intent routing, not timing.

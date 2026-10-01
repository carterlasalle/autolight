# T-FLX-07: Detection, setup and status

Closes F-FLX-05 (setup and status part). Spec: wp08-flx4.md T-FLX-07.

## What changed

- `apps/desktop/src/routes/setup/flx4-panel.tsx` (new): FLX4 setup panel
  reading the existing `Flx4ControllerService` status surface over Web MIDI.
  Shows detection by port name (`DDJ-FLX4`), backend, connection state, last
  message age, message counters and backend attempts, plus a live control
  tester listing recent decoded events (`recentEvents`, updated on input via
  `onEvent`). Losing the controller renders a non-modal `role="status"`
  notice with the service remedy and no dialog; replug recovery renders a
  second `role="status"` confirmation. One shared service instance is owned
  by refcount so setup and the status bar never open the port twice.
- `apps/desktop/src/routes/setup/flx4-panel.test.ts` (new): panel renders
  detection fields and tester rows; unplug notice is `role="status"` with
  the remedy and no dialog; replug renders the reconnected notice.
- `apps/desktop/src/features/setup/setup-view.tsx`: mounts
  `Flx4SetupPanel` after `RkbxSetupAssistant` (setup step 2, controller
  slice). No other setup code touched.
- `apps/desktop/src/components/chrome.tsx`: `Statusbar` adds a controller
  `StatusDot` (connected/searching/lost/failed/unavailable) from the same
  shared hook. Status only, never a modal.

## Proof

- `yarn vitest run src/routes/setup/flx4-panel.test.ts`: 1 file, 3 passed.
- Package-side detection, hotplug poll, reconnect, `portMatch`,
  `lastMessageAgeMs` and drop/unknown counts already covered by
  `packages/controller-flx4` backend tests; this task adds only the UI half.
- Playwright with a virtual port (detection, live tester, unplug notice,
  replug recovery) needs the packaged app and is left to the orchestrator
  run; the unit tests pin the rendered contract it will assert.

## Delete test

- Render the panel from `done`-style static text instead of the service
  status and the detection-fields test goes red; drop `role="status"` for a
  `dialog` and the non-modal test goes red; drop the `recovered` branch and
  the replug test goes red.

## Seams

- `Flx4ControllerService` (package, untouched): detection, hotplug,
  reconnect, event ring. The panel only reads `status()`, `recentEvents()`,
  `onStatusChange()`, `onEvent()`.
- `diagnostics/all` does not yet include controller status; a diagnostics
  tab for the controller would read the same shared hook.
- `@autolight/controller-flx4` resolves through the workspace alias and the
  root `node_modules/@autolight` symlink; it is not listed in
  `apps/desktop/package.json` deps (out of scope for this ticket).

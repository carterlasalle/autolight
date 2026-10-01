# T-LIVE-04: rkbx_link setup assistant

Closes F-LIVE-03 (the setup part). Probe: unit walk of the assistant against
the OSC simulator to "receiving", plus panel render tests.

## What changed

- `packages/rekordbox-live/src/setup-assistant.ts` (new): presentation half
  of the assistant. Reuses `parseRkbxOscConfig` and `checkRkbxSetup` from
  `rkbx-osc.ts`, never reimplements them. Adds the version support table
  (macOS Apple Silicon: 7.2.8, 7.2.17, 7.2.18; Windows with paid license:
  7.2.10; F-LIVE-16, OD-01), build-tag prefix matching so `7.2.10.0333`
  matches its `7.2.10` entry, the packet sample helper fed from provider
  status plus counters plus last address, the plain-words re-sign and sudo
  copy with the project link (`https://github.com/grufkork/rkbx_link`), and
  the capability mapping (`receiving` to PASS, `unsupported-version` to
  `UNAVAILABLE_ON_THIS_DEVICE`, everything else to MISSING).
- `packages/rekordbox-live/src/index.ts`: one added export line for the new
  module; the `rkbx-osc.js` line is untouched.
- `apps/desktop/src/features/setup/rkbx-setup-panel.tsx` (new):
  `RkbxSetupPanel` renders a snapshot (steps, remedy, folder, OSC
  destination vs expected, Rekordbox version, OS support note, packet
  rate plus last address, re-sign plus sudo copy, project link);
  `RkbxSetupAssistant` owns the inputs (folder path loaded from and saved
  to `live.rkbx.configPath`, pasted config text, expected destination from
  `live.rkbx.oscBind`, installed version, platform, observed packets). The
  app never reads the sidecar folder itself: it only checks the text the
  owner pastes. No re-sign call, no sudo, no download exists anywhere in
  this path by construction: the only imports are the pure checking helpers
  and the generic config IPC the whole app uses.
- `apps/desktop/src/features/setup/setup-view.tsx`: mounts
  `RkbxSetupAssistant` below the existing Setup card; follow-mode and setup
  list untouched.
- Tests: `packages/rekordbox-live/src/setup-assistant.test.ts` (10 tests)
  and `apps/desktop/src/features/setup/rkbx-setup-panel.test.ts` (2 tests).

Boundaries: rkbx_link stays a user-installed GPL-3.0 sidecar, never bundled
(T-TRU-10 license check unchanged). `HW-RB-RKBX-01` (owner decision gated,
OD-03) is the hardware capture; no hardware capture is claimed here.

## Proof

Scoped runs, 2026-10-01:

- `yarn workspace @autolight/rekordbox-live vitest run
  src/setup-assistant.test.ts`: 10 passed. The sim walk builds a 60 Hz
  scripted timeline (`buildRkbxDatagrams`), decodes every datagram clean,
  feeds them through a real `RkbxOscProvider`, and the snapshot built from
  the provider counters reports `receiving` with last address `/1/time`.
- `yarn workspace @autolight/desktop vitest run
  src/features/setup/rkbx-setup-panel.test.ts src/routes/routes.test.ts`:
  3 passed. The panel renders rate (`120.0 Hz`), last address, project
  link, and `UNAVAILABLE_ON_THIS_DEVICE` with the re-sign remedy for
  Rekordbox 7.2.10 on macOS; the route table still renders Setup.
- `yarn workspace @autolight/rekordbox-live vitest run
  src/rkbx-osc.test.ts`: 11 passed (no regression in the T-LIVE-03 slice).

## Delete test

Delete the prefix match in `summarizeRKBXAssistant` (pass the raw installed
version through) and the build-tag test (`7.2.10.0333` on Windows) goes red.
Delete the `unsupported-version` capability mapping and the
`UNAVAILABLE_ON_THIS_DEVICE` panel test goes red. Add a `child_process`
import, a `fetch(` call, or a downloader to `setup-assistant.ts` or
`rkbx-osc.ts` and the no-privileged-action test goes red.

# T-LIVE-12: Ableton Link participation

Closes F-LIVE-11.

## What changed

- `packages/rekordbox-live/src/link.ts` (committed source):
  - License boundary: the Link SDK is GPL-2.0-or-later unless Ableton
    grants its proprietary license, so it is never linked in. Behind
    `live.link.mode` (DS-36): `sidecar` (a separately installed bridge
    such as Carabiner, user-installed and never bundled, treated like
    rkbx_link), `sdk` (a native addon seam only if the owner obtains the
    license), `auto` (sidecar when present, SDK build when licensed,
    otherwise `UNAVAILABLE_ON_THIS_DEVICE` with the reason).
  - Bridge wire format: newline-separated JSON over a local TCP socket.
    Sidecar to us carries tempo, session beat, phase, quantum and playing;
    us to sidecar carries `setTempo`/`setPlaying` only when
    `live.link.publish` is true. Malformed lines rejected and counted.
  - Use: tempo and phase input to the composite provider
    (`linkTempo` seam) and the adaptive clock (DS-23), plus
    `linkBeatDisagreement` as the fusion cross-check.
- `packages/rekordbox-live/src/link.test.ts` (this slice, test-only): the
  socket test now waits for the server-side `connection` event after
  `transport.start()` before sending. The client `connect` event can fire
  before the fake sidecar registers its socket, and an immediate send is
  then lost on the floor (4 of 5 direct trials showed the listener never
  firing). No source change, no timing guess: the test awaits the accept
  the code already exposes.

## Proof

Scoped run, 2026-10-01:

- `yarn workspace @autolight/rekordbox-live test`: 18 files, 129 passed.
  That includes `link.test.ts`: the sidecar tempo grammar plus garbage
  rejection, DS-36 mode resolution (sidecar, sdk, auto, unavailable with
  `UNAVAILABLE_ON_THIS_DEVICE`), tempo and phase from a scripted sidecar
  over a real socket (live status, publish round trip, malformed line
  counted), and the phase-agreement cross-check.
- Failure before: the socket test timed out at 5 s on repeated runs
  (2026-10-01, three consecutive failures). Failure after: the full
  package suite passes, including the socket test.

## Delete test

Delete the `connection` wait in the socket test and the race returns
(immediate sends lost, 5 s timeout under load). Delete the malformed-line
count in `ingest` and the rejection test goes red. Delete the
`UNAVAILABLE_ON_THIS_DEVICE` branch in `resolveLinkMode` and the
mode-resolution test goes red.

## Seams

- With the sidecar absent the Settings page shows the remedy (sidecar
  install or licensed SDK build); `HW-RB-LINK-01` with Rekordbox's Link
  enabled is the hardware runbook.
- The composite provider consumes this module through the `linkTempo`
  seam; fusion consumes the phase cross-check.

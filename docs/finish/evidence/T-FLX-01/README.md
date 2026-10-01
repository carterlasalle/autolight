# T-FLX-01: MIDI input backends (DS-13) and non-exclusive observation

Closes F-FLX-01, F-FLX-06. Spec sections 10, 11, 100 (setup step 2).

## What changed

- `packages/controller-flx4/src/backend.ts` (new):
  - `Flx4MidiDriver` is the backend contract: `name`, `sharing`
    (`shared` or `single-client`), `probe`, `listPorts`, `open`. `open` takes
    the port and the message callback only; there is no exclusive option, so
    the controller is always read alongside Rekordbox or Serato.
  - `Flx4ControllerService` selects backends in DS-13 order
    (`AUTO_BACKEND_ORDER`: native, windows-midi-services, webmidi; `auto` is
    the default and single modes are selectable), reports every attempt as
    `Flx4BackendAttempt` (backend, ok, reason), matches ports by
    `flx4.portMatch` (regex, literal fallback when the pattern is invalid),
    and polls the port list at `flx4.hotplugPollMs` for unplug and replug.
    On `lost` it closes the input and reports the reconnect remedy; the next
    poll reopens the port.
  - Every received message is stamped with a monotonic `Ns` at receipt
    (`nowNs`, default `process.hrtime.bigint()`), kept in
    `Flx4MessageRing` (bounded, `flx4` ring size default 512) with a drop
    counter, decoded, and pushed to `recentEvents` for the setup live control
    tester and to `onEvent` subscribers. `status()` carries backend,
    connection, port name, attempt list, `lastMessageAtNs`,
    `lastMessageAgeMs`, received, dropped and unknown counts for the status
    bar and Diagnostics.
  - Windows single-client failure: when the chosen driver declares
    `single-client` and the platform is Windows, an open refusal reports
    connection `unavailable-on-this-device` with the remedy "Rekordbox is
    holding the FLX4 input; install Windows MIDI Services or use a Rekordbox
    source that does not need the controller". Other failures carry a
    per-backend remedy (install the addon, install Windows MIDI Services,
    start the hidden audio window).
  - Default drivers are real adapters: `createNativeDriver` loads
    `@julusian/midi` (RtMidi) and uses `Input`, `getPortCount`,
    `getPortName`, `openPort`, `on("message")`, `closePort`;
    `createWindowsMidiServicesDriver` loads the Windows MIDI Services binding
    and uses `listInputPorts` / `openInput`; `createWebMidiDriver` uses
    `navigator.requestMIDIAccess` and `onmidimessage`. Loaded modules and
    bindings are narrowed with `in`/`typeof` guards before use.
- `packages/controller-flx4/src/index.ts` re-exports the new modules and the
  legacy `CC`/`NOTE` values are corrected to the official list (see T-FLX-02).

## Proof

- `packages/controller-flx4/src/backend.test.ts`, 14 tests:
  `falls back through native, Windows MIDI Services and Web MIDI, reporting
  each attempt`; `reports UNAVAILABLE_ON_THIS_DEVICE when the only backend
  cannot load`; `reports the Rekordbox-holds-the-port remedy for a
  single-client Windows open failure` (and asserts the remedy does not appear
  on macOS); `reads the same port from two services at once without an
  exclusive open` (two services over one driver both receive the message, and
  `open` is called with exactly two arguments); `matches ports by name,
  including a custom pattern`; `detects unplug and replug through the hotplug
  poll` (status listener sees connected, lost, connected; one close, two
  opens); `keeps messages in a bounded ring with a drop counter and ages the
  last message`; `counts unknown messages in the status`; `arms and clears
  the hotplug poll on the injected scheduler`; `bounds the ring directly`;
  plus the platform driver tests (RtMidi surface, WinMM single-client vs
  CoreMIDI shared, Windows-only gating and binding wiring, Web MIDI access
  and the no-navigator failure reason).
- `docs/finish/evidence/T-FLX-01/green-run.txt`: the package run above,
  42 tests in 5 files passing, and a scoped typecheck with zero diagnostics.
- The existing app consumer of the legacy hint path still passes unchanged:
  `yarn workspace @autolight/desktop vitest run src/app/services.test.ts`
  (17 tests) exercises `CC.CHANNEL_FADER_1`, `CC.FILTER_2`,
  `CC.CROSSFADER` and `NOTE.PLAY_1` through `MidiService`.

## Delete test

Delete the `sharing === "single-client" && platform === "win32"` branch in
`selectAndOpen` and the Rekordbox remedy test goes red (the remedy falls back
to the generic addon hint). Delete the ring bound check in
`Flx4MessageRing.push` and both drop counter tests go red. Delete the
`ports.some(...)` early return in `poll` and the hotplug test reddens on the
lost transition. Delete `attempts.push` for failed probes and the fallback
test reddens on the attempt list. Delete the Web MIDI navigator guard and the
default Web MIDI probe falls through instead of reporting the hidden audio
window reason.

## Seams

- The `@julusian/midi` dependency, its Electron rebuild and `asarUnpack` entry
  (T-OPS-05) are packaging work outside this slice: the driver loads the
  addon lazily and reports its absence as a typed reason, which is what the
  fallback chain consumes. No package manifest was edited here by design
  (sibling slices own those files this wave).
- The Windows MIDI Services Node binding ships with packaging; until then the
  driver reports it as not loadable and the remedy text explains what to
  install.
- Hardware proof of the real two-app read on macOS (Rekordbox plus AutoLight
  at once) and of the WinMM held-port failure is HW-FLX-01 in the WP15
  runbook; this slice proves the selection, reporting and reopen logic with
  injected drivers and proves the default drivers against their documented
  binding surfaces.
- The main-process wiring (ControllerService instance, IPC port, setup step
  and status bar, T-FLX-07) consumes this service; the package side exposes
  everything that work needs (`status`, `onStatusChange`, `recentEvents`,
  `recentMessages`).

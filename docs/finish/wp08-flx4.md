# WP08. DDJ-FLX4 telemetry

Spec sections: 10 (composite inputs), 11, 63 (fader confirmation), 100
(setup step 2). Findings closed: F-FLX-01 to F-FLX-06, F-LIVE-06 (MIDI
acquisition part), F-LIVE-12 (controller-observed states).

## 0. Starting point

`packages/controller-flx4` has constants and pure helpers (`classifyCC`,
`confirmAudible`, `sevenBit`, `compositeDeckState`) with no production
callers. No MIDI library is installed
anywhere. The MIDI channel is ignored, so deck 1 and deck 2 are
indistinguishable. Nothing opens the device.

## 1. Required reading

- Pioneer DJ "DDJ-FLX4 MIDI message list" (official PDF from the product's
  support page). Commit a text transcription of the tables you use under
  `packages/controller-flx4/docs/midi-map.md` with the document's version and
  date, and cite it in the map file header. Every constant in code must match
  a row there or a recorded capture.
- `@julusian/midi` README (native RtMidi binding, Electron rebuild needs).
- Microsoft "Windows MIDI Services" documentation (multi-client MIDI on
  Windows) and the WinMM single-client limitation.
- Web MIDI API (Chromium) for the renderer fallback.

## 2. Facts to design around

- macOS CoreMIDI lets several clients read the same source, so AutoLight can
  observe the FLX4 while Rekordbox uses it.
- Windows WinMM MIDI input is single-client: if Rekordbox holds the FLX4
  input, a second reader can fail to open it (F-FLX-06, unverified on the
  owner's setup). Windows MIDI Services provides multi-client access where it
  is installed. The app must detect which case it is in and say so.
- FLX4 telemetry is secondary truth (spec 11). It never overrides a DJ
  software playhead; it confirms, hints, and fills fields nothing else has.
- High-resolution controls on Pioneer controllers usually send a 14-bit pair
  (MSB and LSB on two CC numbers). Confirm per control from the official list
  and captures; do not assume the offset.
- The tempo fader's pitch range is a Rekordbox setting (6, 10, 16 percent,
  wide), not visible in MIDI.

## 3. Tasks

### T-FLX-01 MIDI input backends (DS-13) and non-exclusive observation

- Closes: F-FLX-01, F-FLX-06.
- `yarn workspace @autolight/controller-flx4 add @julusian/midi` and add it to
  the Electron rebuild and `asarUnpack` lists (`T-OPS-05`).
- Backends behind `flx4.backend` (DS-13):
  - `native`: `@julusian/midi` in a main-process `ControllerService`;
  - `windows-midi-services`: the Windows MIDI Services client API (through a
    small native addon or its supported Node binding), multi-client;
  - `webmidi`: Web MIDI in the hidden audio window (`T-AUD-01`), forwarded
    to main over the typed IPC, labelled lower priority because it depends on
    a window;
  - `auto` (combined, default): native, then Windows MIDI Services, then
    WebMIDI, each attempt reported.
- Port matching by `flx4.portMatch`; hotplug detection (poll the port list
  at `flx4.hotplugPollMs` or use backend events); reconnect automatically.
- On Windows, when the open fails because another client holds the port,
  report `UNAVAILABLE_ON_THIS_DEVICE` with "Rekordbox is holding the FLX4
  input; install Windows MIDI Services or use a Rekordbox source that does
  not need the controller", and the composite provider degrades visibly.
- Messages are timestamped at receipt with `Ns` and put into a bounded ring
  with a drop counter (S26).
- DoD: tests with a virtual MIDI port for open, receive, unplug and replug on
  the macOS CI runner (RtMidi can create CoreMIDI virtual ports there).
  RtMidi cannot create virtual ports on Windows (WinMM), and hosted Linux
  runners usually have no ALSA sequencer device, so on those platforms the
  decoder and state tests run from recorded captures, and the port-level
  tests run on a self-hosted runner with a loopback endpoint (Windows MIDI
  Services loopback where installed) or on the owner's machine through
  `HW-FLX-01`. The Windows single-client failure is proven on real hardware
  in `HW-FLX-01` (open the FLX4 while Rekordbox holds it), and its reporting
  path is unit-tested by injecting the backend's open error. `HW-FLX-01` on
  the owner's Mac with Rekordbox running proves both apps receive input at
  once.

### T-FLX-02 Full control map with deck separation

- Closes: F-FLX-02, F-FLX-03; probe `P-11-flx4-map`.
- Implement the complete map from the official list: PLAY, CUE, SHIFT
  (and every SHIFT layer), jog (touch, rotation, outer ring versus platter,
  vinyl mode behaviour), tempo fader (14-bit), SYNC, loop in, loop out,
  reloop or exit, beat length and loop halve or double controls, the four
  pad modes and their pads (hot cue, pad FX, beat jump, sampler, and the
  SHIFT modes), hot cues, channel faders (14-bit), crossfader (14-bit), EQ
  high, mid, low (14-bit), TRIM, CFX or colour filter (14-bit), headphone
  cue buttons, master and headphone levels where sent, browse encoder and
  press, LOAD per deck, and any other message the list documents.
- Decoding keys on status byte, channel and data 1; deck derives from the
  channel per the list. Every message maps to a typed `Flx4Event` with deck,
  control, value (normalized 0 to 1 for continuous, boolean for buttons),
  raw bytes and timestamp.
- Unknown messages are kept as `unknown` events with raw bytes, counted, and
  visible in the DJ Event Inspector (never dropped silently).
- Recording tool: `tools/capture/flx4/record.ts` (run with `yarn`) records a
  labelled session (control name prompts, move each control through its
  range) to `protocol-fixtures/flx4/<date>/*.ndjson`.
- DoD: decoder test over the committed capture of every control, asserting
  deck and control for each; 14-bit pairs reconstruct monotonically across the
  full fader travel; unknown-message count is zero on the full capture (or
  every unknown is documented in `midi-map.md` as not in the official list).

### T-FLX-03 Controller state model

- Closes: part of F-FLX-03 (state, not only events).
- Maintain per-deck and mixer state from events: play and cue button state,
  SHIFT, active pad mode, pad pressed, loop active (as last observed), jog
  touched and jog velocity, tempo fader position, channel fader, EQ, filter,
  crossfader, headphone cue. Expose it read-only to the provider manager and
  the director with timestamps and `quality: "estimated"` for anything that
  is inferred from button presses rather than observed state.
- Tempo mapping: `flx4.tempoRange` `source` (default) fits the fader to pitch
  from a DJ-software provider when one reports pitch, with the fitted range
  shown in Settings; fixed ranges 6, 10, 16 and wide selectable.
- DoD: state tests driven by captured sequences (for example LOAD then PLAY
  then jog touch then release); tempo fit test recovers the range from a
  simulated provider within 0.5 percent.

### T-FLX-04 Transport-relevant signals for the runtime

- Closes: F-FLX-03 (runtime part), F-LIVE-12 (controller part).
- Derive and publish: scratch detection (jog touch plus velocity reversals,
  thresholds `runtime.scratch.*`), cue-hold, hot cue press with pad number,
  loop in, out, halve, double and exit, pad roll start and stop with the roll
  length when the pad mode is roll, beat jump, SYNC toggles, and the fader
  and crossfader values used by the mixer (`T-MIX-01`, DS-26 `controller`
  source).
- These are hints: the fusion provider only uses them where no DJ-software
  source supplies the field, or to confirm one (spec 11).
- Research probe `HW-FLX-02` (HW runbook): whether the controller's LED feedback
  from Rekordbox (which carries Rekordbox's own state) can be observed on the
  owner's OS without a driver; record the result and, if it can, add it as a
  confirmation input.
- DoD: SIM tests show a jog scratch trace produces SCRATCH HOLD in the
  runtime (`P-61-scratch`) only when the DJ-software playhead confirms
  reverse or stall, or when no stronger source exists.

### T-FLX-05 Expressive hints for the director and mixer

- Closes: F-FLX-04.
- Convert controller activity into `ExpressiveHint` events with strength and
  duration, never into direct lighting (spec 11 "no random reaction"):
  large filter sweep (magnitude and direction over `flx4.hints.filterWindowMs`)
  reduces density; pad roll emphasises spatial subdivision; channel fader
  rising on the incoming deck advances the introduction stages (`T-MIX-05`);
  loop shrink increases motion cadence; loop release marks an impact
  opportunity at the next beat; EQ bass kill and return mark a "bass
  re-entry" opportunity.
- Hints go to the adaptive director (`T-RUN-09`) and the mixer, which decide
  with restraint (`T-PLAN-05` budgets apply to live decisions too). Each hint
  and whether it was used is visible in the DJ Event Inspector.
- DoD: tests per hint from captured sequences; a director test shows a loop
  release yields at most one impact per restraint window.

### T-FLX-06 Composite provider integration

- Closes: F-LIVE-06 (MIDI part).
- Feed the state model and events to `T-LIVE-07` over an in-process
  subscription with bounded queues. The composite provider's contract-suite
  run uses a virtual MIDI port driven by the captured sessions.
- DoD: `P-10-composite` passes with MIDI from a virtual port, not a mock.

### T-FLX-07 Detection, setup and status

- Closes: F-FLX-05.
- Setup step 2 (spec 100) detects the FLX4 by port name, shows backend,
  connection state, last message age, and a live control tester (move a
  fader and see it). The status bar shows the controller state; loss of the
  controller is a non-modal notification during Live.
- DoD: Playwright test with a virtual port: detection, live tester, unplug
  notification, replug recovery; screenshot evidence.

## 4. Config keys added (added to `03` section 3.8)

`flx4.hotplugPollMs` (2000), `flx4.hints.filterWindowMs` (1500),
`flx4.hints.enabled` (list of hint types, all on). Defaults unmeasured.

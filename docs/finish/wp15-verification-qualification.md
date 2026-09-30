# WP15. Verification, qualification and gates

Spec sections: 104, 116 to 129, 152, 153. Findings closed: F-QA-02 to F-QA-07,
F-QA-09 (with `T-MIX-04`), F-QA-10 (with `T-ANA-16`), F-QA-11 to F-QA-13,
F-ANA-26 (with `T-ANA-16`), F-X-16 (re-verification).

This package owns the machinery that decides whether anything is true: test
classes, the Electron E2E harness, replay, simulators with fault injection,
the performance harness, soak, the sync matrix, physical measurement with a
camera, the curated validation set, goldens, the owner review protocol and
the gates. Build its harness pieces early because they prove everything else
(`T-QA-02` in M0; `T-QA-03` and `T-QA-05` in M1; `T-QA-04` in M2), the
validation set at the start of M3 (`T-QA-09`), and run its qualification
pieces in M6.

## 1. Tasks

### T-QA-01 Every test class exists and is enforced

- Closes: spec 126; probe `P-126-classes`.
- Tag every test with one class from spec 126 (unit, schema, property,
  protocol-replay, analysis golden, planner golden, renderer golden, device
  simulator, fault injection, desktop E2E, performance, soak) through file
  naming (`*.property.test.ts`, `test_*_golden.py`, `apps/desktop/e2e/*.spec.ts`, and so on) or a
  tag registry. A CI step counts tests per class and fails if any class has
  zero, and prints the unique test count (S18).
- A file name is not enough. Each class also has named required suites that
  must exist and must have run in the CI or nightly artifacts being checked:
  performance is the `T-QA-05` harness run with a `measurement.json`; soak is
  the `T-QA-06` nightly wall-clock run with its trend report; protocol replay
  is the `T-QA-03` harness over every committed real fixture; desktop E2E is
  the `T-QA-02` suite including `m1-slice.spec.ts` and
  `normal-night.spec.ts`; the three golden classes are the `T-ANA-16`,
  `T-PLAN-15` and `T-REND-06` suites; device simulator and fault injection
  are the `T-QA-04` suites. The class checker reads the artifacts, not only
  the file tree.
- DoD: CI output lists all 12 classes with counts and the required suites'
  artifact paths; removing the only test of a class, or skipping a required
  suite, fails CI (red runs saved).

### T-QA-02 Electron E2E harness

- Closes: F-QA-02, F-X-16 (re-verify); used by every UI probe.
- Playwright with `_electron.launch` against the built app (and against the
  packaged app in the smoke-install job). Linux runs under `xvfb-run`; macOS
  and Windows runners run natively. Re-verify the claim that Electron boots
  under xvfb (F-X-16) and record the result.
- Test fixtures: a Simulator-mode profile in a temp userData directory;
  access to the recording transport's received frames and timestamps through
  a test-only IPC channel compiled only into test builds (and rejected by the
  release bundle scan); helpers for keypress timestamps, snapshot waits and
  screenshots.
- The harness also carries the two acceptance specs: `apps/desktop/e2e/m1-slice.spec.ts`
  (`99-final-acceptance.md` section 2, written here in M0 as a failing probe
  whose red run is evidence; it must pass for the M1 exit) and the skeleton of
  `normal-night.spec.ts` (completed by `T-QA-11`).
- The emergency E2E steps below are the procedure behind `P-94`. The
  measurement itself is owned by `T-UI-03` and `T-RUN-07`; they are written
  out here so nobody shortcuts them:
  1. Launch the app in Simulator mode with the normal-night scenario and
     three simulated fixtures (the simulated H6076 and H1A45 behaviour sets
     from `T-GOV-14`; real profiles replace them after `T-GOV-13`).
  2. Wait until all three are armed and the show is rendering (recording
     transport receiving frames at the qualified rate).
  3. Record `t0` (Playwright wall clock and the app's monotonic clock through
     the test channel) and press B.
  4. Read the recording transport: the first frame after `t0` whose cells are
     all zero for each fixture, and its send timestamp; assert zero `turn`
     commands and zero kelvin `colorwc` for 2 s after.
  5. Repeat 200 times with random delays; compute p50, p95, p99 of
     keypress-to-send; assert p99 under 100 ms (target 20 ms); write
     `measurement.json`.
  6. Press B again (toggle off) and A (resume at next bar): assert the resume
     lands on the next native downbeat.
- DoD: harness in CI on all three OSes with one real E2E test that launches
  the built app in Simulator mode, waits for READY and reads frames from the
  recording transport; the xvfb result for F-X-16 recorded; `m1-slice.spec.ts`
  committed with its red run.

### T-QA-03 Protocol replay harness

- Closes: F-QA-11, F-LIVE-02 (with `T-LIVE-09`); probe `P-128-replay-decodes`.
- Replays raw captures (Rekordbox Lighting, rkbx_link OSC, ProLink, OS2L,
  Serato Remote, FLX4 MIDI, Govee status replies) through the real decoders
  and providers at 1x, 2x, 10x and step mode, with a virtual clock so speed
  changes time, not only timestamps; compares normalized `DeckStateV2`
  sequences with `expectedEvents` (tolerances for timing fields from config
  `qa.replay.*`).
- Fixture lint: non-empty capture, decoder version, platform, software
  version, action, and `expectedEvents` written by a human (the lint checks
  an `expectedBy` field that is not the decoder).
- DoD: every committed real fixture passes at all speeds; a decoder mutation
  fails replay; an empty capture fails lint.

### T-QA-04 Simulators and fault injection at application level

- Closes: F-QA-05, F-QA-12 (with `T-GOV-14`); probe `P-104-sim-suite`.
- Simulators on real sockets or ports, each with its own contract tests:
  Govee LAN device (discovery, JSON commands, razer, status, per-SKU
  profiles, rate ceilings, firmware strings), BLE peripheral (through the
  transport's adapter seam), Matter virtual light (matter.js), rkbx_link OSC
  emitter, ProLink players, OS2L client, Serato Remote peer, Rekordbox
  Lighting transport (after captures define it), virtual FLX4 MIDI port,
  Link sidecar, Rekordbox library (SQLCipher fixture) and ANLZ files.
- Fault injection transport and network shim (config `qa.faults.*`):
  latency (fixed and jitter), loss, duplication, reordering, bandwidth
  throttle, disconnect and reconnect, port 4002 taken by another process,
  multicast blocked, client isolation, DJ source silence, malformed packets,
  worker kill, show host kill, renderer reload.
- Every spec 105 to 109 scenario runs as an application-level test (the whole
  app in Simulator mode), not as a unit test of a policy function.
- DoD: `P-104`; fault scenario suite green with measurements (recovery time,
  frames during fault, stale frames delivered, which must be zero).

### T-QA-05 Performance harness

- Closes: F-QA-05; probe `P-117-perf`.
- Measures, on the reference Mac and the reference Windows machine: show
  host tick period and jitter (p50, p95, p99, max) over 10 minutes with the
  UI busy (scrolling the Library, opening the Inspector) and during GC
  pressure; render time per tick with 2,000 cells; IPC latency for intents
  and snapshots; UI frame time on Live; DJ message processing time and queue
  depths (all bounded); emergency latency (`P-94`); CPU and memory.
- Output `measurement.json` with machine description, app version, config
  hash and the command used. A 10-minute timing job runs on every PR in CI
  (on the CI runner, with thresholds relaxed by `qa.perf.ciSlack`, and
  reported but not compared to the reference machine), and the full run on
  the reference machines before each milestone exit.
- DoD: the harness measures every quantity above and writes
  `measurement.json` on CI and on the reference Mac (and the Windows
  reference machine once OD-12 names it); a deliberately injected 20 ms stall
  in the show host shows up in its jitter report (red run saved). The spec
  117 targets themselves are asserted as blocking checks by the tasks that
  own the behaviour (`T-ARC-06` jitter, `T-REND-07` render time, `T-UI-13` UI
  frame time, `T-UI-03` and `T-RUN-07` emergency latency) and by
  `99-final-acceptance.md` section 1.

### T-QA-06 Soak

- Closes: F-QA-03; probe `P-125-soak`.
- Nightly SIM soak: 4 hours of wall-clock time (not accelerated), the full
  app in Simulator mode with a scripted DJ set (track changes every 3 to 6
  minutes, loops, seeks, pitch changes, crossfades, device disconnects every
  20 minutes, a source dropout every 30 minutes, UI activity), sampling every
  10 s: heap and RSS per process, handles, queue depths, per-device
  superseded and stale frames, estimator error, latency, worker liveness, UI
  frame time.
- Pass conditions (spec 125) with trend tests: no memory growth trend (linear
  regression slope of RSS after warm-up below `qa.soak.maxMemSlopeMbPerHour`),
  no output-queue growth (max depth 1 per device), no fixture drift (frame
  hash comparison against the expected plan at checkpoints), no increasing
  latency (slope below `qa.soak.maxLatencySlopeMsPerHour`), no stale track
  state (generation checks at each change), no dead worker, no UI
  degradation (frame time slope).
- The old fake soak is `apps/desktop/e2e/soak.spec.ts` with its `soak()`
  helper, which resets `pending = 0` on every iteration so `maxPending <= 1`
  can never fail (F-QA-03). Delete it. If a fast throughput check is still
  useful, write a new `simulator-throughput.test.ts` whose queue counter is
  owned by the real transport under test (never reset by the test), show it
  failing against a deliberately unbounded queue (red run saved), and never
  call it a soak.
- HW soak runbook `HW-SOAK-01`: 4 hours on the owner's rig with real
  software, the same sampling, and a video sample every hour.
- DoD: nightly job green three nights in a row; HW soak report.

### T-QA-07 Track-sync qualification matrix

- Closes: F-QA-05; probe `P-119-sync-matrix`.
- The 20 manipulations of spec 119 (normal playback, pitch plus or minus 8 and
  16 percent, play and pause, cue restart, hot cue jump, forward seek, back
  seek, 4-beat loop, 1-beat loop, 1/2 loop, 1/4 roll, scratch, reverse where
  supported, sync toggles, two decks, crossfade, incoming track, master
  switch, track replacement) run per provider that claims them, on SIM with
  scripted inputs and on hardware with the runbook `HW-SYNC-01`.
- Metric per row: beat error of the rendered cue timing against the known
  beat (from the simulator's ground truth, or from camera measurement against
  the audio on hardware), p95 below `qa.sync.maxBeatErrorMs`; cue timing stays
  tied to beats (spec 119).
- DoD: matrix table per provider in evidence; a provider that fails a row
  shows that row as `FAIL` in its capability status (not hidden).

### T-QA-08 Physical output qualification with a camera

- Closes: spec 118, 122, 123, 124; probes `P-118-physical`,
  `P-122-h6076-dod`, `P-123-h1a45-dod`, `P-124-multi-dod`, part of `P-55`.
- Tool `tools/camera/` (Python through `uv run`, OpenCV): the app emits a
  measurement sequence (white flashes and blackouts at known show-clock times
  on all fixtures, then per-cell walks) and logs send timestamps; a 240 fps
  video of the rig is analysed by region (one region per fixture or cell
  group, drawn once by the owner) to find visible onsets; the tool outputs
  per-fixture visible latency and the cross-fixture spread.
- Uses: measure per-unit latency for calibration (DS-17 `measured`); verify
  visible impact spread p95 within about 50 ms after calibration (spec 118);
  verify the H6076 (13 items, two units), H1A45 (10 items) and multi-device
  (10 demonstrations) definitions of done with video evidence per item. The
  multi-device configuration is exactly spec 124's: two H6076, one H1A45,
  and at least one additional compatible Govee fixture, or, if the owner has
  none, a simulated fixture from `T-GOV-14` running alongside the real ones
  and shown in the preview and the recording transport.
- DoD: reports per unit and per demonstration; every item of spec 122 to 124
  checked with its video timestamp.

### T-QA-09 Curated visual validation set

- Closes: F-ANA-26, F-QA-13; probe `P-116-validation-set`.
- A manifest (`qa/validation-set.yaml`) listing tracks from the owner's
  library by TrackId and path, at least `qa.validation.minPerCategory` per
  spec 116 category (house, tech house, EDM, bass music, hip-hop, pop, rock,
  disco, fake drops, long breakdowns, tempo changes, weak intros, irregular
  structure). Audio is never committed; the manifest and the generated
  artifacts' summaries are.
- The owner picks the tracks; the agent prepares a candidate list from the
  library with the analysis that suggests each category, for the owner to
  confirm.
- Review tooling: for each track, render the show on the owner's venue (or
  the reference room) to a video with the waveform, sections, events and
  preview side by side, plus the spec 115 diagnostics; a review sheet
  template per track covering the spec 116 aspects (structure, drop timing,
  restraint, recurrence, contrast, colour coherence, spatial behaviour,
  transition handling).
- This task runs first in M3 because the analysis and planner tasks tune
  against the set. The owner's full review of every track happens in
  `HW-REVIEW-01` under `T-QA-13`.
- DoD: manifest complete and confirmed by the owner (OD-10); the render tool
  produces a video and a pre-filled review sheet for one validation track on
  the reference room (evidence).

### T-QA-10 Goldens everywhere, updated deliberately

- Closes: F-QA-04; probes `P-127-goldens`, `P-129-no-self-write`.
- Analysis (`T-ANA-16`), planner (`T-PLAN-15`) and renderer (`T-REND-06`)
  goldens share one mechanism: missing goldens fail; `yarn golden:update
  --reason` is the only writer and records reasons; determinism tests compare
  against committed goldens, never output to itself.
- DoD: a CI check fails if any test writes into `test-fixtures/goldens`
  outside the update command (S2).

### T-QA-11 Gates and the Rekordbox definition of done

- Closes: F-QA-06; probes `P-120-rekordbox-dod`, gates `152 A` to `152 H`.
- A gate report generator (`yarn gates`) that maps each gate and each spec
  120 item to the probes that prove it, reads their latest results and
  evidence, and prints PASS, FAIL or MISSING per item and per OS. Spec 120
  items 17 and 18 (macOS passes, Windows passes) require the Rekordbox suite
  to run on both, including the AX provider on Windows (`T-LIVE-06`) or its
  documented `UNAVAILABLE_ON_THIS_DEVICE` status with the remaining providers
  covering every item.
- Gates: A DJ data (Rekordbox and Serato suites), B track intelligence, C
  Govee segmented local rendering on H6076 and H1A45, D show compiler, E
  runtime, F UI without developer tools, G reliability (soak), H packaged
  application on clean machines.
- Owns the normal-night acceptance: completes
  `apps/desktop/e2e/normal-night.spec.ts` (`99-final-acceptance.md` section
  3, all 17 rows), runs it nightly on SIM, and collects `HW-NIGHT-01`.
  Probe `P-1-normal-night` (matrix rows 1 and 150) resolves here.
- DoD: `normal-night.spec.ts` green on SIM three nights in a row;
  `HW-NIGHT-01` report; the gate report shows every gate PASS with links to
  evidence; it is the input to `99-final-acceptance.md`.

### T-QA-12 Property tests

- Closes: F-QA-07.
- fast-check and Hypothesis across the domain: beat mapping, estimator,
  seek reconstruction equivalence, mixer weights, blend round trips, codec
  encode and decode (razer, BLE, OSC, ProLink, Serato tags), room fields
  (WP05 properties), config validation, contract validation, planner
  invariants over generated TrackModels, restraint budgets.
- DoD: property tests in each listed module; shrinking outputs saved for any
  failure found and turned into regression tests.

### T-QA-13 The owner's "professional looking" review

- Closes: F-QA-13; probe `P-151-review`.
- A review protocol for spec 151: for a set of reference moments (breakdown,
  build, imminent event, drop, returning chorus, incoming track), render
  videos on the owner's rig (and SIM renders), and ask the owner whether a
  viewer can infer each moment from the lights alone. The owner's answers,
  with timestamps and notes, are the evidence. Failed moments become planner
  tasks, re-rendered and re-reviewed.
- Also runs the full validation-set review (`HW-REVIEW-01`): the owner fills
  the `T-QA-09` review sheet for every track; tracks that fail an aspect get a
  planner fix, a re-render and a re-review.
- DoD: owner sign-off document in evidence, covering both the spec 151
  moments and every validation track's review sheet.

## 2. Hardware and real-software runbooks

Every runbook lives in `docs/qualification.md` (generated section per ID) and
is copied into the evidence folder of the task that needs it. Each has:
purpose, prerequisites (hardware, software versions, owner decisions),
exact steps (app screens and commands), what to record, pass criteria, and
the files to send back. The app exports each runbook's results as a zip from
Diagnostics.

| ID | Purpose | Task |
| --- | --- | --- |
| `HW-GOV-01` | Discovery and identity per unit (all ladder rungs, MAC, SKU, firmware, port 4002 conflict check) | T-GOV-05, T-GOV-06 |
| `HW-GOV-02` | razer capability probe per unit (status, arm, B2 state, native resolution sweep, fallback) | T-GOV-10 |
| `HW-GOV-03` | 16-step qualification wizard per unit (rate ceiling, stability, latency, orientation) | T-GOV-11 |
| `HW-GOV-04` | Blackout with stream armed (100 cycles), RGB white, brightness path, no power commands | T-GOV-09 |
| `HW-GOV-05` | Disconnect and reconnect (power the lamp off and on, Wi-Fi drop, router restart) | T-GOV-06, T-GOV-08 |
| `HW-GOV-06` | IDENTIFY, TEST CHASE, RECALIBRATE, identify walk | T-GOV-12 |
| `HW-GOV-07` | ptReal scenes as idle and ending looks | T-GOV-18 |
| `HW-BLE-01` | BLE scan, binding to LAN identity, link, masked zones, encrypted link detection, write budget | T-BLE-01 to T-BLE-07 |
| `HW-BLE-02` | OS permission prompts on the packaged app | T-BLE-08 |
| `HW-MAT-01` | Matter commissioning with multi-admin pairing and control | T-MAT-01 to T-MAT-03 |
| `HW-FOV-01` | Failover scenarios on the real network (client isolation, multicast blocked) | T-FOV-02 |
| `HW-ROOM-01` | Draw the owner's room, map the ceiling strip (seam, corners, gaps, mirrored check), verify orbit, room probes | T-ROOM-03, T-ROOM-04, T-ROOM-12 |
| `HW-RB-LIB-01` | Library reader counts against Rekordbox | T-RBL-01 |
| `HW-RB-RKBX-01` | rkbx_link OSC capture (owner decision gated) | T-LIVE-03 |
| `HW-RB-PL-01` | Does the owner's setup emit PRO DJ LINK packets; capture if so | T-LIVE-05 |
| `HW-RB-AX-01` | Accessibility element trees on macOS and Windows | T-LIVE-06 |
| `HW-RB-COMP-01` | Composite provider lock time and error | T-LIVE-07 |
| `HW-RB-AGENT-01` | Agent API liveness and token sources | T-LIVE-08 |
| `HW-RB-LIGHT-01` | Lighting IPC surface inventory and full capture matrix on macOS and Windows (owner decision gated) | T-LIVE-09 |
| `HW-RB-MEM-01` | Clean-room memory reader offsets (owner decision gated) | T-LIVE-11 |
| `HW-RB-LINK-01` | Ableton Link with Rekordbox | T-LIVE-12 |
| `HW-FLX-01` | Non-exclusive MIDI observation with Rekordbox running | T-FLX-01 |
| `HW-FLX-02` | LED feedback observability | T-FLX-04 |
| `HW-SER-01` | Serato Remote session capture | T-SER-01, T-SER-05 |
| `HW-SYNC-01` | Spec 119 matrix on real software | T-QA-07 |
| `HW-CAM-01` | Camera latency, spread and definitions of done for H6076, H1A45 and multi-device | T-QA-08 |
| `HW-SOAK-01` | Four-hour soak on the rig | T-QA-06 |
| `HW-INST-01` | Clean-machine install on the owner's second machine or a VM | T-OPS-06 |
| `HW-REVIEW-01` | Owner review of the validation set and spec 151 moments | T-QA-09, T-QA-13 |
| `HW-NIGHT-01` | The normal-night script of `99-final-acceptance.md` section 3 on the real rig, recorded | T-QA-11 |

## 3. Config keys added (added to `03` section 3.11)

`qa.replay.timeToleranceMs` (5), `qa.faults.*` (scenario parameters),
`qa.perf.ciSlack` (3x), `qa.soak.maxMemSlopeMbPerHour` (5),
`qa.soak.maxLatencySlopeMsPerHour` (1), `qa.sync.maxBeatErrorMs` (20),
`qa.validation.minPerCategory` (3). All unmeasured targets except where the
spec gives the number.

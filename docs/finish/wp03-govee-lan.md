# WP03. Govee LAN transport

Scope: everything between the renderer's per-fixture frame and the light over
the local network. Read before starting:

- `govee-toolkit` (pinned 0.5.0, commit `ceef296f6382881c5f07698d78fb5719ebca6686`):
  `docs/protocol/lan.md` in full (especially 1 "Consecutive commands",
  "Latency notes", 2.1 to 2.3 and 2.7), `devices/families/lan-razer.yaml`,
  `devices/H61A0.yaml`, `devices/schema.yaml`, `docs/modes.md`,
  `docs/architecture.md`, `packages/rust/src/stream/{mod.rs,sender.rs,rate.rs}`,
  `packages/node/binding.d.cts`.
- `wez/govee2mqtt` `src/lan_api.rs` (discovery ladder, missing `ip`, 4002
  conflict message, status retry) and `docs/LAN.md`.
- `runtalan/lightwave` `govee-lightwave/{DISCOVERY,ARCHITECTURE,DELIVERY}.md`.
- `lasswellt/govee-homeassistant` `ARCHITECTURE.md` and `transport_health.py`.
- The official Govee WLAN guide (the five documented commands and the SKU list;
  both H6076 and H1A45 are listed).
- `docs/research/prior-art-reuse.md` sections 2 and 3.

Protocol facts you must encode (from the toolkit, cite it in code headers):

- Envelope: UDP JSON to `device:4003`: `{"msg":{"cmd":"razer","data":{"pt":"<base64>"}}}`.
- Raw frame: `BB <len_hi> <len_lo> <opcode> <payload> <xor>`, where `len` is the
  payload length only (16-bit big endian) and `xor` is the XOR of every
  preceding byte including `BB`. A wrong length is dropped silently.
- `B1 [0|1]` arm and disarm; `B0 [gradient, nbSeg, RGB x nbSeg]` paint;
  `B4 [gradient, nbSeg, (R,G,B,zone) x nbSeg]` zoned variant on some models;
  `B2 [0|1]` armed state inside the undocumented `status` reply
  (`{"msg":{"cmd":"status","data":{"onOff":..,"brightness":..,"pt":"<base64>"}}}`).
  A payload of 0 does not prove the model lacks the channel.
- Arm golden vector: `bb 00 01 b1 01 0a`.
- Sequence: `turn(1)`, then arm, then wait the unit's arm-settle time
  (toolkit default about 50 ms), then paint. A paint right after arming is lost.
- While armed: never send `turn` (can end the channel on some models) and
  never send a white `colorwc` (ends the channel). `brightness` applied and
  kept the channel on every model measured.
- Disarm ends the colours: the unit returns to the colour its last non-stream
  command left. Keep the channel armed for the whole show.
- A unit may not answer `status` or `devStatus` while armed. Do not treat
  silence during a stream as a device failure.
- Three datagrams back to back: the third can be silently dropped. Space
  consecutive commands to one device.
- Frame rate ceiling falls with zone count; H61A0 measured clean 40 Hz at 20
  zones, 25 Hz at 60, 20 Hz at 120; unmeasured units fall back to 10 Hz.
- Native resolution is discovered by sweeping `nbSeg` and observing
  changepoints; it depends on physical length. A chain can fold back.
- Brightness is global over LAN (no per-segment dimmer); intensity comes from
  RGB scaling (spec 49).

---

### T-GOV-01 Bring in govee-toolkit

- Closes: F-GOV-01, spec 44.
- `yarn workspace @autolight/govee add govee-toolkit@0.5.0` (exact version).
  Configure `@electron/rebuild` or the prebuilt ABI match, and `asarUnpack` for
  `**/*.node`. Load it inside the show host in every DS-07 mode and record
  which load (napi-rs addons are context-aware; prove it in a worker thread).
- Wrap it behind `packages/govee/src/engines/toolkit.ts` implementing the
  `LanStreamEngine` interface: `discover()`, `status(id)`, `openStream(id, {resolution, rate, gradient})`,
  `setAll(Uint8Array)`, `framesSuperseded`, `rateHz`, `zones`, `close()`,
  `identify()`, `segment()` (non-stream paint), `health()`.
- Keep a fork (`vendor/govee-toolkit` as a git subtree or a separate repo
  referenced in `PIN.md`) only for device profiles (T-GOV-13); do not modify
  the protocol code unless qualification proves a bug, and then upstream it.
- DoD: `P-44-toolkit-loaded` passes against the LAN simulator; load result per
  host mode recorded; `PIN.md` updated with how the dependency is consumed.
- Metrics: addon load time; stream open time against the simulator.

### T-GOV-02 Native TypeScript razer engine

- Closes: F-GOV-02, scar S20.
- Rewrite `packages/govee/src/razer.ts`: `encodeRaw(opcode, payload)`,
  `envelope(raw)` (JSON plus base64), `arm(on)`, `paint(colors, {gradient})`,
  `paintZoned(entries, {gradient})`, `parseStatus(json)` (returns onOff,
  brightness, armed from the `B2` frame), plus the four official commands and
  `devStatus` parsing. Implement `LanStreamEngine` on our own persistent
  sockets (T-GOV-04) with the same pacing semantics as the toolkit (fixed
  interval emitter, unchanged frames not re-sent, missed ticks skipped not
  burst, superseded counter, disarm on close).
- Golden vectors: generate byte sequences with govee-toolkit (Node binding or
  its Rust tests) for arm, disarm, B0 with 1, 14, 20, 60, 120, 255 zones with
  gradient 0 and 1, B4 examples, and a status reply; commit them under
  `protocol-fixtures/govee/razer/`. Property test: decode(encode(x)) equals x
  and the checksum validates for random payloads.
- DoD: `P-46-razer-bytes` passes; old `encodeFrame` deleted; zero
  differences from toolkit vectors.

### T-GOV-03 Engine switch DS-02 and parity

- Closes: DS-02.
- `govee.lan.engine`: `toolkit`, `native-ts`, `auto`. In `auto`, use the
  toolkit; if the addon fails to load, or a device's toolkit stream reports an
  error class, use native-ts for that device and show "native engine (reason)"
  on the device tile.
- Parity test: the same frame sequence through both engines against the
  simulator produces identical datagrams (content and order), modulo timing.
- DoD: E2E flips the switch mid-show with no more than one arm-settle gap per
  device; parity test green.

### T-GOV-04 Persistent sockets

- Closes: F-GOV-06, F-GOV-13 partial, scar S16.
- The govee-manager owns: one UDP socket bound to `govee.lan.ports.reply`
  (4002) on the chosen interfaces, receiving discovery replies and status
  replies, routed by sender IP (govee2mqtt pattern); one send socket per
  interface (unbound or ephemeral) reused for every command and frame. No
  socket is created per send. No `child_process` anywhere in this package.
- If 4002 is in use, fail loudly with a message that names likely holders
  (Govee Desktop, homebridge-govee, SignalRGB, Govee LAN Control, another
  AutoLight) and how to fix it; the status is visible in Devices and
  Diagnostics.
- DoD: `P-106-device-loss` and a socket-count test (the process holds a fixed
  number of UDP sockets after 10,000 frames); port-conflict E2E test with a
  dummy listener.
- Metrics: send call time p99; zero child processes (asserted via process list
  in the test).

### T-GOV-05 Discovery ladder

- Closes: F-GOV-07, F-GOV-25, DS-16.
- Rungs, each a setting (section 3.6 of the config doc): multicast
  `239.255.255.250:4001` joined on every eligible interface (not only the
  default one); directed broadcast per interface (enumerate interfaces with
  `os.networkInterfaces()`, compute broadcast from address and netmask, skip
  loopback and link-local unless enabled); global broadcast; explicit scan
  list (IPs or hostnames resolved each round); cached IPs from the device
  registry (unicast scan to each known device).
- Timing: resend every `retryInitialMs` doubling to `retryMaxMs`, never
  stopping; background rescan every `backgroundRescanMs`; immediate rescan on
  network change events and on app resume from sleep.
- Replies: accept a reply without `ip` by using the sender address, warn when
  `ip` and sender disagree (govee2mqtt issue 437); validate required fields;
  key by device MAC (`device`), never by IP; record which rung found it.
- DoD: SIM tests for each rung alone (multicast blocked, broadcast blocked,
  only unicast works); a reply without `ip` accepted; E2E shows the rung per
  device; network-change rescan measured.
- Metrics: time to first discovery per rung in SIM; time to rediscover after
  IP change.

### T-GOV-06 Device registry and health

- Closes: F-GOV-09, F-GOV-13, F-RUN-10 partial.
- Persisted registry (DB tables `devices`, `device_capabilities`,
  `device_calibrations`): MAC (primary key), SKU, BLE and Wi-Fi hardware and
  software versions, name (user alias), IP history, last seen, rung, enabled
  transports, per-transport health (govee-homeassistant pattern: last success,
  last failure, consecutive failures, RTT), requested state versus observed
  state with generation counters (Lightwave pattern), qualification status.
- UI and IPC use the MAC-keyed device ID everywhere (fixes the IP versus
  device-ID mismatch).
- Per-device FPS backoff from delivery feedback (supersede rate, status RTT
  growth) that reduces only that device's physical rate; logical show stays at
  60 Hz (spec 107); floor `govee.lan.backoff.minFps`.
- DoD: IDENTIFY from the UI reaches the right device in E2E; health visible;
  backoff test on a throttled simulated device.

### T-GOV-07 Read-back

- Closes: F-GOV-08.
- `devStatus` read-back after non-stream commands: resend every
  `govee.lan.status.retryMs` until a reply or `deadlineMs`; route by sender;
  record observed state and RTT; skip while armed (the unit may not answer).
  The Diagnostics copy states exactly what was verified.
- DoD: SIM test with delayed and dropped replies; UI shows observed versus
  requested.

### T-GOV-08 Stream lifecycle and newest-frame-wins

- Closes: F-GOV-03, F-GOV-13, F-GOV-14, F-GOV-22, F-GOV-23, spec 46, 51, 106, 107, 149.
- For each fixture with a verified segmented LAN capability: ensure on (only
  before arming), arm, wait the unit's measured arm-settle (default from
  config), open the stream at the qualified resolution and a rate from the
  device's measured `frame_rate` table for that zone count (fallback
  `govee.lan.stream.fallbackHz`), then `setAll` the latest frame from the
  renderer each tick. The engine sends at its own rate; intermediate frames
  are superseded, never queued. Unchanged frames are not re-sent (optionally a
  keepalive re-send every `govee.lan.stream.keepaliveMs` if qualification shows
  a unit needs it; measure).
- Never send `turn` or kelvin `colorwc` while armed (runtime invariant
  T-TRU-12). Space any non-stream commands to one device by
  `govee.lan.command.minSpacingMs`.
- `close()` cancels pending frames (fix of F-GOV-14), sends disarm, and the
  handle cannot flush afterwards. Frames are copied into the engine's own
  buffer on `setAll` (no shared mutable buffers).
- Reconnect: when a device reappears (discovery or status) after loss, re-arm,
  wait settle, send the current frame only.
- DoD: `P-47`, `P-51`, `P-106`, `P-107` pass in SIM; recording transport
  shows zero turn commands during a 10-minute show; stale frames delivered 0.
- Metrics per device: frames requested, sent, superseded, send rate,
  reconnect time.

### T-GOV-09 Blackout, white, intensity and master brightness policy

- Closes: F-GOV-05, F-GOV-16, F-GOV-30, spec 47, 48, 49, 50, DS-27.
- Blackout (planned, emergency or manual) is an all-zero frame on an armed
  stream. White hits are RGB white scaled in linear light. Intensity is RGB
  scaling in linear light (renderer, T-REND-03). Global `brightness` is only
  sent for master intensity changes, setup, and long fades, rate-limited by
  `govee.brightness.maxPerMinute`, and the renderer compensates in RGB so the
  look stays continuous when master brightness steps.
- H1A45 white LEDs (RGBWWIC): default DS-27 `rgb-white`. The `white-channel`
  mode is implemented only as a qualification experiment that proves whether a
  white command disarms the stream on that unit; it is never enabled without a
  passing qualification record.
- DoD: `P-47`, `P-48`, `P-50` pass with the recording transport; emergency
  blackout latency `P-94` measured.

### T-GOV-10 Capability probe and verified fallback

- Closes: F-GOV-04, F-GOV-24, F-X-09, spec 42, 147, 153.
- Delete `collapseToSingleColor` and every "single-zone over LAN" claim.
- Probe per unit during qualification and on firmware change: send `status`,
  arm, wait settle, read `status` again for `B2 = 1` (if the unit answers while
  armed), paint a known two-colour pattern, and ask the user to confirm what
  they see (the only reliable signal, because paints never acknowledge). Also
  probe `B4`. Record the outcome.
- If the segmented channel is not verified, the fixture uses a verified
  whole-fixture mode (LAN `colorwc`, BLE single colour, or Matter) with a
  visible "SINGLE-ZONE (fallback)" badge and the renderer's single-zone
  representation (T-FOV-03). This is a degraded state, shown as such, not a
  success. The spec 122 and 123 definitions of done require the segmented
  path; a fallback never counts toward them.
- If a unit does not answer LAN at all although the Govee app shows the LAN
  switch on (the reported firmware revision issue), the device is flagged
  "LAN unavailable on this firmware" with the troubleshooting steps and BLE
  as the offered alternative.
- DoD: SIM tests for three simulated firmware behaviours (segmented works,
  segmented silently ignored, LAN absent); HW runbook for each owner unit.

### T-GOV-11 Qualification wizard runner

- Closes: F-GOV-11, F-GOV-12, F-GOV-22, F-GOV-24 (per-unit LAN presence recorded), F-X-07, spec 52, 53, 54.
- Implement all 16 steps of spec 52 as a resumable state machine with a UI
  (T-UI-09) and per-step evidence stored in `device_calibrations`:
  1 discover, 2 identify (flash and user confirm), 3 read SKU, 4 read firmware
  (scan reply fields), 5 verify power (read-back), 6 verify global brightness
  (read-back), 7 verify RGB (read-back), 8 verify local RGBIC stream (T-GOV-10
  probe with user confirmation), 9 logical segment count (user counts distinct
  bands in a stripe pattern for candidate counts, plus the changepoint sweep
  from lan.md 2.3 for native resolution), 10 segment order (single moving
  zone, user confirms direction), 11 reverse orientation (user chooses correct
  or reverse), 12 arm settle (sweep delays from 0 to 200 ms, user or camera
  confirms the first paint that lands), 13 stable output frequency (rate sweep
  per resolution with a pattern designed to reveal stutter: a one-zone chase
  at known speed; user or camera marks the first stutter; the rate below is
  stable; supersede counters recorded), 14 visual latency (camera or photodiode
  measurement procedure from T-QA-08, or a guided tap test as a fallback with
  its lower accuracy recorded), 15 reconnect (user power-cycles the unit; the
  app times re-arm and first frame), 16 save calibration keyed by hardware ID
  plus SKU plus firmware.
- Firmware change: mark `REQUALIFICATION REQUIRED`, keep normal control per
  spec 147, run background checks, and require steps 8, 9, 12, 13 before
  segmented streaming resumes.
- Every number displayed in the UI comes from this record or says
  "unmeasured".
- DoD: `P-52-wizard` passes in SIM end to end through the state machine's
  typed API with a scripted virtual user (confirmations, counts and
  direction answers supplied by the test, camera steps by the simulator's
  rendered zones) and persists every step's result; the UI flow over the
  same state machine is proven in `T-UI-09`; `HW-GOV-03` per unit completed
  by the owner (BLOCKED-HARDWARE until then).

### T-GOV-12 IDENTIFY, TEST CHASE, RECALIBRATE, identify walk

- Closes: F-GOV-10.
- IDENTIFY: capture observed state, flash full white for
  `govee.identify.flashMs` (through the stream if armed, else `colorwc` RGB
  white), then restore the previous state (or the current show frame).
- TEST CHASE: a single zone travels start to end then end to start at
  `govee.testChase.stepMs`, through the stream at the qualified resolution; on
  single-zone fixtures a three-step brightness ramp in RGB.
- RECALIBRATE: opens the qualification wizard at a chosen step.
- Identify walk (toolkit `Govee.identify` pattern): lights each device in
  turn so the user can name and place them.
- DoD: each action invoked through the typed IPC API produces the exact byte
  sequences at the recording transport (IDENTIFY flash and restore, TEST
  CHASE both directions, RECALIBRATE entering the wizard at the chosen step,
  identify walk order); comments match behaviour. The device screen path of
  `P-99-device-actions` is proven in `T-UI-08`.

### T-GOV-13 H6076 and H1A45 profiles

- Closes: F-GOV-15, spec 45.
- From qualification results, write `devices/H6076.yaml` and
  `devices/H1A45.yaml` in the toolkit schema in our fork (and our app profile
  DB) with capabilities, modes, measurements (arm settle, frame rate table by
  zones, native pixels per length, segment chain, turn and white behaviour,
  status-while-armed behaviour) and the unit's firmware and length. Profiles are
  defaults for new units of that SKU; every unit is still qualified.
- Offer upstream PRs to govee-toolkit (owner decision).
- DoD: profiles committed with measurement receipts; toolkit catalog loads
  them in tests.

### T-GOV-14 Simulators and recording transports

- Closes: F-QA-12, F-GOV-23, spec 104.
- `packages/simulator/govee-lan`: a device simulator on real UDP sockets
  (bind a loopback alias or a configurable port set) implementing scan, the
  four commands, devStatus, status with `B2`, razer arm, paint (B0 and B4),
  disarm, and configurable traps (third back-to-back command dropped, `turn`
  ends channel, white ends channel, no status while armed, frame-rate
  ceiling with stutter model, arm settle, packet loss, latency, jitter,
  duplication, reorder, disappearance and IP change). It exposes its rendered
  zone colours for assertions and for the Simulator mode preview.
- Recording transport: wraps an engine and records every datagram with
  timestamps for assertions.
- Fault-injecting transport: wraps an engine with the same fault list.
- DoD: simulator contract tests; used by every GOV probe.

### T-GOV-15 Segment resolution selection

- Closes: F-GOV-28, spec 53, DS-20.
- Offer logical (the count the Govee app exposes), grouped (a divisor chosen
  for stability), and native (measured N). `auto` picks the highest that is
  confirmed, stable, and meets the refresh target
  (`govee.lan.stream.targetHz`, config). Store the evidence.
- DoD: SIM test with a device whose ceiling makes native too slow; auto picks
  grouped; UI shows why.

### T-GOV-16 Network hygiene and trust status

- Closes: F-GOV-20, F-GOV-26, spec 111.
- Bind only interfaces selected in `govee.lan.interfaces` (default: all private
  LAN interfaces, never public addresses); never listen on a WAN interface;
  show the bound interfaces, the subnet, whether multicast works (tested by
  discovery), whether devices on the subnet respond (client isolation
  detector: devices known from cache do not answer unicast while the host is
  on the same subnet), firewall hints per OS, and the SignalRGB checklist (LAN
  toggle in Govee Home, same subnet, not a guest network, AP or client
  isolation off, firewall inbound and outbound rules).
- DoD: Diagnostics network tab shows each item; E2E with SIM.

### T-GOV-17 Unknown firmware policy

- Closes: F-GOV-21, spec 147.
- Unknown firmware: normal control continues with the last verified
  capability; background qualification checks run when the show is idle;
  a diagnostic warning appears; a failing raw stream is not retried more than
  `govee.lan.stream.maxRearmAttempts` per `govee.lan.stream.rearmWindowMs`;
  fallback only to verified capability.
- DoD: `P-147-unknown-fw` passes in SIM.

### T-GOV-18 ptReal scenes over LAN

- Closes: F-GOV-27.
- Implement `ptReal` passthrough (base64 BLE-format packets over LAN, as in
  govee2mqtt `lan_api.rs:188-250`) for setup, idle and ending looks (spec 133
  ending look option "scene"). Scene codes come from the cloud scene catalogue
  when the owner enables cloud, or from a stored catalogue.
- Never used for show frames.
- DoD: SIM test for the packet; HW runbook step; ending-look option works.

### T-GOV-19 Device metrics

- Closes: F-GOV-29, spec 99, 107, 131.
- Per device: frames requested, sent, superseded, effective FPS, status RTT,
  last response time, health state, current transport and engine, reconnect
  count. Exposed in Devices, Diagnostics and the session recorder.
- DoD: metrics visible and asserted in E2E with SIM.

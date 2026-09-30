# WP04. BLE, Matter, cloud and transport failover

The owner asked for BLE to be set up fully and for the LAN, BLE, Matter, cloud
ladder from the research notes. Spec 148 fixes the priority for show frames
(LAN segmented, then BLE segmented if verified, then whole-fixture LAN) and
bars the cloud from frames. Matter is added at the owner's request as a local
whole-fixture path. Nothing here may weaken spec 148.

Read before starting:

- govee-toolkit `docs/protocol/ble.md` (all 9 sections), `docs/modes.md`,
  `devices/H61A0.yaml` (`measurements.ble`), `devices/H6008.yaml`
  (`render_hold_ms`), `packages/rust/src/ble/`, the Node binding (`ble` is
  compiled into the prebuilt npm addon: `packages/node/Cargo.toml` enables
  features `lan`, `ble`, `cloud`).
- govee-homeassistant `custom_components/govee/api/{ble.py,ble_packet.py,ble_crypto.py}`
  (MIT): segmented versus single-zone encodings, the `SEGMENTED_MODELS`
  allowlist approach, the protocol v2 AES-GCM session (version characteristic
  `00010203-0405-0607-0809-0a0b0c0d2b12`, handshake header `E7 11 01`, 16-byte
  GCM tag; a 12-byte tag is silently ignored by the device).
- Lightwave `DISCOVERY.md` (BLE discovery-only lessons, distinct IDs, macOS
  permission identity).
- matter.js (`@matter/main`) controller documentation and its Electron
  controller example (a proof of concept, treat as a reference only).
- govee-toolkit `docs/protocol/cloud.md` (rate limits, segment instances).

BLE protocol facts to encode (cite toolkit `ble.md` sections in code):

- GATT service `00010203-0405-0607-0809-0a0b0c0d1910`; write characteristic
  `...2b11` (write without response only; with-response is refused); notify
  characteristic `...2b10`.
- One connection at a time; a connected device stops advertising; after a
  drop, a device can stay silent for seconds.
- 20-byte frames `proType, commandType, payload padded to byte 18, XOR of
  bytes 0 to 18` for `0x33` (write), `0xAA` (read), `0xA1` (provisioning),
  `0xA3` (chunked); `0xA5` host colour frames are short with a sum checksum.
- Writes are acknowledged on notify as `33 <cmd> <status>` where `00` means
  accepted, not applied. Read back to verify.
- Power `33 01 <0|1>`; brightness `33 04 <level>` (scale is per family:
  1 to 100 or 0 to 255); colour `33 05 0d <RGB> <K_hi K_lo> <RGB white>` (one
  colour), `33 05 15 01 <RGB> <K> <RGBw> <mask>` (masked zones, LSB first,
  `ceil(count/8)` bytes), legacy `33 05 02 ...`; masked brightness
  `33 05 15 02 <level> <mask>`; per-zone brightness `33 05 15 03 <levels>`;
  zone interpolation `33 a3 <0|1>`.
- Reads: `aa 01` power, `aa 04` brightness, `aa 0f` segment count, `aa 40` IC
  count (matches LAN native resolution), `aa 05` sub-mode, `aa 14` Wi-Fi MAC,
  `aa 20`/`aa 21` hard/soft versions, `aa 06`, `aa 07 03`, `aa ab`, `aa a5 <group>`.
- Host colour channel: `a5 02 90` probe, `a5 02 83 <RGB>` one colour; render is
  temporary (`render_hold_ms`), lights a device whose stored state is off,
  reports nothing, scaled by stored brightness.
- Encoded link: advertisement flag byte bit `0x40` means encoded frames only;
  handshake `E7 01`, `E7 02` with a session seed (toolkit); newer firmware
  (govee-homeassistant) uses AES-GCM with keys from the vendor app.
- Write budget: sustained writes per second per unit (100 Hz on the one H61A0
  measured); a burst past it makes the firmware unresponsive for seconds, so
  pacing is mandatory. A segmented repaint costs one write per distinct colour.
- Identity: advertisement names `GBK_<SKU>_<hex>`, `GV<SKU><hex>`, or legacy
  `ihoment_`, `Govee_`, `Minger_`; Bluetooth address is not the Wi-Fi MAC;
  bind them explicitly (read `aa 14` for the Wi-Fi MAC when supported, and ask
  the user to confirm).

---

## BLE

### T-BLE-01 BLE backends and placement (DS-04)

- Closes: F-BLE-01.
- `govee.ble.backend`: `toolkit-ble` (the govee-toolkit Node binding in `ble`
  mode, btleplug underneath), `noble` (`yarn workspace @autolight/govee add @stoprocent/noble`,
  our own codec from `packages/govee/src/ble/`), `auto` (toolkit if it loads
  and scans, else noble; per-device override when one backend fails a device).
- Prove where each backend can run: show host worker thread, utility process,
  or main. If a backend requires the main thread (possible on macOS
  CoreBluetooth), run the BLE link manager in main and pass frames from the
  show host through a latest-wins MessagePort; record the measured added
  latency. Do not assume; test.
- DoD: both backends connect to the BLE simulator (T-BLE-09) and to the owner's
  units (HW runbook); DS-04 switch works live; placement results documented.

### T-BLE-02 Scan and identity binding

- Closes: F-BLE-01, F-BLE-04, F-BLE-02 (identity).
- Scan with name-family parsing and manufacturer-data parsing (encoded flag,
  pactType, pactCode, read live on every scan). BLE devices appear as
  "Bluetooth" entries distinct from LAN entries. Binding a BLE address to a
  LAN device requires either an `aa 14` Wi-Fi MAC read that matches, or an
  explicit user confirmation after an identify flash over BLE. Never merge by
  SKU, name or address suffix.
- Handle "one connection at a time": if a device is expected but not
  advertising, show "possibly connected to the Govee app or another controller;
  close it" guidance.
- DoD: SIM tests for each name family and flag; E2E binding flow.

### T-BLE-03 Link manager and pacing

- Closes: F-BLE-01, F-BLE-02 (link and budget).
- One link per device; reconnect with backoff; advertising-gap tolerance;
  notify subscription; write pacing against the unit's measured
  `write_budget_hz` (default `govee.ble.writeBudgetHzDefault` with an
  "unmeasured" badge); hold the link at least `write_drain_ms` after the last
  write before any intentional disconnect; newest-state-wins (a new frame
  replaces unsent writes); a burst guard that never exceeds the budget even
  under catch-up.
- DoD: SIM test with a device that becomes unresponsive when the budget is
  exceeded: the link manager never triggers it; reconnect test.

### T-BLE-04 Command set and dialects

- Closes: F-BLE-01, F-BLE-02 (commands).
- Implement power, brightness (per-family scale from the device profile),
  colour (single `0d`, masked `15 01`, legacy `02`), masked brightness
  `15 02`, per-zone brightness `15 03`, interpolation `a3`, and all reads.
  Parse acknowledgements; verify by read-back where supported; record the
  dialect per device in its profile.
- DoD: golden vector tests from toolkit `ble.md` examples and from
  govee-homeassistant packet builders; SIM round trips.

### T-BLE-05 BLE segment stream

- Closes: F-BLE-01, F-BLE-02 (segments), spec 148 (BLE segmented tier).
- Convert a frame into masked writes: group zones by identical colour, one
  `33 05 15 01` write per distinct colour, ordered to minimise visible tearing
  (largest group first, config). The achievable frame rate is
  `budget / distinctColours`; the renderer is told the fixture's current
  effective capability so the planner and mixer can simplify patterns on BLE
  fixtures (fewer distinct colours per frame). Optional colour quantisation
  (`govee.ble.colorQuantizeLevels`) reduces distinct colours.
- Single-colour fast path: when every zone has the same colour, use one write
  (`0d`) or the host colour channel `a5 02 83` if qualified (note its
  temporary render hold; refresh before `render_hold_ms` expires).
- Blackout on BLE: masked write of black to all zones (never power off during a
  show, same rule as spec 47).
- DoD: SIM test: a two-colour chase at 20 fps holds pacing; frame rate reported
  correctly; HW runbook with the owner's units.

### T-BLE-06 BLE qualification

- Closes: F-BLE-01, F-BLE-02 (measurements).
- Wizard steps for BLE: connect, read versions, `aa 0f` segment count, `aa 40`
  IC count, masked-write verification (user confirms), write budget benchmark
  (raise rate until acknowledgements stop or the device stalls, then back off
  and record `write_budget_hz`, burst ceiling and recovery time), write drain
  measurement (write, disconnect after n ms, read back), render hold
  measurement for the host colour channel, latency (camera procedure).
- DoD: results stored in `device_calibrations` with transport `ble`;
  SIM-verified; HW runbook.

### T-BLE-07 Encrypted link (DS-05)

- Closes: F-BLE-01, F-BLE-02 (encoded-link flag and handshake), F-BLE-06, F-SEC-04.
- Implement both known schemes behind `govee.ble.encryptedLink`
  (`off`, `on`, `auto`): the toolkit `E7 01`/`E7 02` session-seed handshake and
  the govee-homeassistant protocol v2 (version characteristic `...2b12` byte 1
  equals 2, AES-GCM with a 16-byte tag, handshake header `E7 11 01`, verify the
  decrypted reply carries the device's SKU and MAC). Port the Python logic to
  TypeScript with a provenance header (MIT, lasswellt/govee-homeassistant).
- The static keys are vendor constants. Store them in the BLE protocol
  constants file; do not print them in docs. Shipping them in the product is an
  owner decision (briefing section 7): until the owner decides, the build
  reads them from a local file the owner provides, and the UI shows
  "encrypted-link devices need keys (see docs/troubleshooting.md)".
- DoD: SIM supports both schemes; unit tests reproduce govee-homeassistant's
  known vectors; DS-05 visible.

### T-BLE-08 OS permissions

- Closes: F-BLE-01, F-BLE-03.
- macOS: `NSBluetoothAlwaysUsageDescription` in the app's Info.plist via
  electron-builder `extendInfo`; permission status read and shown; Setup has an
  explicit "Allow Bluetooth" step (Bluetooth access on macOS is a TCC privacy
  permission driven by the usage string; the `com.apple.security.device.bluetooth`
  entitlement only matters for sandboxed apps, which AutoLight is not).
  Windows: an NSIS-installed Win32 app declares no capabilities; check the
  adapter state and the Windows privacy setting for Bluetooth and show the fix
  path. Linux (development only): BlueZ and group permissions documented.
- DoD: packaged app prompts once (HW runbook screenshot); denied state shows
  the fix path.

### T-BLE-09 BLE simulator

- Closes: F-BLE-01, F-QA-12 (BLE).
- A simulated peripheral behind the backend adapter seam (toolkit's
  `Transport::with_adapter` and a noble-compatible fake) implementing GATT,
  acknowledgements, reads, masked writes, budget stall behaviour, encoded
  link, advertisement families and the one-connection rule.
- DoD: contract tests; used by every BLE probe in CI.

### T-BLE-10 BLE Wi-Fi provisioning helper

- Closes: F-BLE-01, F-BLE-05 (campus and venue networks).
- A Setup tool to move a light onto another Wi-Fi network over BLE (toolkit
  `provision_wifi`: `33 17 01`, 3 s wait, chunked `A1 11` transfer at 300 ms
  pacing, `33 17 00`), for venues where the owner brings a travel router to
  avoid client isolation. The password is read into memory only for the
  transfer and never stored unless the owner opts to save it in `safeStorage`.
  Warn that BLE provisioning is plaintext over the air.
- DoD: SIM test with the toolkit's worked example bytes; HW runbook.

## Matter

### T-MAT-01 Matter controller process

- Closes: F-MAT-01.
- `yarn workspace @autolight/govee add @matter/main` (pin the version). Run the
  controller in an Electron utility process with its own storage directory;
  fabric credentials encrypted with `safeStorage` keys supplied by main.
  Commission devices on-network with a pairing code or QR payload (manual
  entry and camera scan), including multi-admin codes from Apple Home, Google
  Home or SmartThings when the device is already in another ecosystem. BLE
  commissioning (`@matter/nodejs-ble`) is optional and gated by T-BLE-01
  results.
- DoD: commission a matter.js virtual light (T-MAT-04) in CI; HW runbook for
  any owner Govee device that supports Matter (detect support from the
  device's Matter QR, cloud metadata, or product documentation; do not assume
  by SKU).

### T-MAT-02 Matter control mapping

- Closes: F-MAT-01.
- OnOff, LevelControl (with transition time 0 for show use), ColorControl
  (hue and saturation, or XY; colour temperature only outside show-time
  frames). Measure the sustainable command rate per device
  (`govee.matter.commandRateHz` receipt). Capability: whole fixture only.
- DoD: SIM tests; rate measurement in evidence.

### T-MAT-03 Matter identity binding

- Closes: F-MAT-01.
- Bind a commissioned Matter node to a Govee device record (user confirmation
  after an identify flash; vendor and product IDs from the Basic Information
  cluster recorded). Never auto-merge.
- DoD: E2E binding flow with the virtual light.

### T-MAT-04 Matter simulator

- Closes: F-MAT-01, F-QA-12 (Matter).
- A matter.js virtual colour light started in tests (on-network commissioning
  with a fixed test pairing code).
- DoD: CI job commissions and controls it.

## Cloud

### T-CLD-01 Cloud metadata client

- Closes: F-CLD-01, F-GOV-17.
- Govee OpenAPI client (API key from `safeStorage`, never logged): device
  list, capabilities (including declared segment counts and instances),
  names, scene catalogues. Rate limiting per `govee.cloud.*` with accounting
  from response headers; clear errors when limits are hit. Disabled by default
  (`security.cloudAllowed` false); never used during Live for anything
  time-critical; never carries frames (runtime invariant).
- DoD: tests against recorded responses (sanitised); limit accounting test.

### T-CLD-02 Cloud cross-check in qualification

- Closes: F-CLD-01.
- When enabled, qualification compares the cloud-declared segment count with
  the measured one and records any mismatch in the device's evidence.
- DoD: SIM test with a declared count that disagrees.

## Failover

### T-FOV-01 Transport model and policy (DS-03)

- Closes: F-GOV-18, spec 148.
- Replace `LanTransport` with a `Transport` union: `lan-razer`, `lan-json`,
  `ble-segmented`, `ble-single`, `matter`, `cloud-metadata`. Each fixture has
  an ordered list of enabled transports (user-editable per device) and each
  transport has a verified capability record from qualification.
- `govee.failover.policy`: `strict` (use the first enabled transport only,
  never switch), `auto` (use the best verified transport at any moment),
  `hybrid` (default; segment frames only on verified segmented transports,
  whole-fixture fallback allowed with a visible banner; never cloud for
  frames).
- Per-device transport mode (DS-31, key `govee.device.<fixtureId>.transportMode`),
  shown as a dropdown on every device tile and in the device screen, with the
  current effective transport beside it:

  | Mode | What it does | Frames allowed | Beat-critical use |
  | --- | --- | --- | --- |
  | `auto` | Best verified transport at any moment (follows `govee.failover.policy` `auto`) | Yes, on segmented transports | Yes |
  | `hybrid` (default) | Segment frames only on verified segmented transports; whole-fixture fallback with a banner | Yes | Yes |
  | `lan-segmented` | razer stream only; never switches | Yes | Yes |
  | `lan-basic` | LAN JSON `colorwc` whole fixture, rate limited by `govee.lan.command.minSpacingMs` | Whole-fixture colour only | Yes, degraded, with banner |
  | `ble-segmented` | BLE masked-zone stream only | Yes, within the BLE write budget | Yes |
  | `ble-basic` | BLE single-colour writes | Whole-fixture colour only | Yes, degraded, with banner |
  | `matter-basic` | Matter OnOff, Level, ColorControl | Whole-fixture colour only, at `govee.matter.commandRateHz` | Degraded only, with banner |
  | `cloud-basic` | Govee OpenAPI single colour and scene | Never frames | Never. Allowed only outside Live (setup, idle look, ending look) and when `security.cloudAllowed` is true; rate limited by `govee.cloud.*`; the runtime invariant in `T-TRU-12` rejects any cloud call scheduled from the show clock |

  A mode that the fixture has not been qualified for is shown disabled with
  the reason ("BLE not qualified on this unit"). The failover policy never
  overrides an explicit single-transport mode; that is the strict stance the
  toolkit takes ("modes are explicit per device, no silent failover").
- DoD: `P-148-ladder` passes in SIM: LAN blocked, BLE segmented takes over;
  both blocked, whole-fixture via Matter or LAN JSON; policy switch visible.
  Each of the eight per-device modes has a SIM test that proves which
  transport carried the bytes (recording transport per engine) and a
  Playwright test that the dropdown changes it and the tile shows the
  effective transport. `cloud-basic` has a test proving a cloud call attempted
  from the show tick is rejected and reported.

### T-FOV-02 Failover state machine and the campus scenario

- Closes: F-BLE-05.
- Detect LAN loss per fixture (no status replies and no discovery within
  `govee.failover.lanLossMs` when not armed; stream health signals when armed),
  switch per policy, probe the preferred transport every
  `govee.failover.probeIntervalMs`, switch back at a bar boundary. Every switch
  is logged, shown on the device tile and in the status bar, and recorded.
- Scenario tests in SIM: multicast blocked, client isolation (unicast
  blocked), router restart, Wi-Fi drop, BLE out of range.
- DoD: all scenarios pass with measured switch times; E2E shows banners.

### T-FOV-03 Capability-aware rendering for degraded fixtures

- Closes: DS-21, part of F-GOV-04 follow-through.
- The renderer receives each fixture's current effective capability (zones,
  max distinct colours per frame, max rate). Single-zone fixtures show a
  representative colour computed by `render.singleZone.representative`;
  BLE fixtures with a distinct-colour budget get frames simplified by merging
  similar colours in OKLab; the planner's spatial choices avoid depending on a
  degraded fixture for motion (it becomes an ambient participant).
- DoD: golden frames for each capability class; owner visual review video.

# WP14. Persistence, security and operations

Spec sections: 80 to 82, 103, 110 to 112, 130 to 133, 145, 152 H, 153.
Findings closed: F-DATA-01 to F-DATA-08 (F-DATA-08 in `03`), F-SEC-01 to
F-SEC-04 (F-SEC-04 in `wp04`), F-OPS-01 to F-OPS-10 (F-OPS-03 in `04`,
F-OPS-07 and F-OPS-08 in `wp00`), F-APP-05 (security part), F-APP-15,
F-APP-16 (launcher part), F-ANA-22 and F-ANA-29 (packaging part), F-GOV-20
(binding part), F-CLD-01 (secret storage part), F-UI-11 (metrics part).

## 1. Persistence (T-DATA)

### T-DATA-01 Storage service and drivers (DS-06)

- Closes: F-DATA-01, F-DATA-02, F-APP-15; probe `P-80-db-open`.
- A main-process `StorageService` opens the application database in
  `app.getPath("userData")/autolight.db` at startup stage 2 (spec 132), WAL
  mode verified by reading the pragma back, `synchronous` and busy timeout
  from config (`storage.sqlite.*`), foreign keys on. Kysely on top.
- DS-06 drivers: `better-sqlite3` (spec 80; `yarn workspace
  @autolight/storage add better-sqlite3 kysely`, Electron rebuild), and
  `node-sqlite` (Node's built-in `node:sqlite`; confirm it loads inside the
  app's Electron by checking `process.versions.node` and importing it in a
  startup self-test, because the repo depends on Electron `^41.10.6` and the
  "Electron 33 lacks node:sqlite" comment is stale and is deleted),
  combined `auto` (better-sqlite3, falling back to node:sqlite if the native
  module fails to load, with a visible status).
- The database is completely separate from Rekordbox and Serato data.
- DoD: `P-80` (the app opens the DB in userData in WAL mode, from the
  packaged build); driver parity test runs the whole storage suite on both
  drivers.

### T-DATA-02 Schema and migrations

- Closes: F-DATA-03; probe `P-81-schema`.
- Versioned migrations (Kysely migrator) creating every spec 81 table:
  `tracks`, `source_identities`, `native_analysis`, `analysis_runs`,
  `analysis_artifacts`, `show_plans`, `show_edits`, `devices`,
  `device_capabilities`, `device_calibrations`, `venues`,
  `fixture_placements`, `fixture_groups`, `show_styles`, `sessions`,
  `diagnostic_events`, `protocol_versions`; plus the tables this plan needs:
  `track_aliases` (`T-ID-01`), `analysis_jobs` (`T-ANA-02`), `config_values`
  (`T-CFG-02`), `rooms` and `room_anchors` (WP05, or columns in `venues`),
  `qualification_records` (per device, transport and firmware),
  `capability_status` (runtime capability states, `00` section 5.1a).
- Every migration has an up test on an empty DB and on a DB at the previous
  version with data; downgrade is refused with a clear message.
- DoD: `P-81` lists all tables; migration tests; a DB created by the first
  release migrates to the final schema.

### T-DATA-03 Cache versioning and selective invalidation

- Closes: F-DATA-03; probe `P-82-invalidation`.
- Every artifact row carries schema version, analyzer version, planner
  version, source fingerprint and config hash (spec 82). Plan cache key: track
  fingerprint, planner version, style hash, venue capability class hash,
  config snapshot hash (`T-PLAN-01`).
- Rules: analyzer change invalidates analysis-dependent artifacts only;
  planner change reuses TrackModels and regenerates plans; venue change
  reuses TrackModels and semantic plans (the renderer adapts); style change
  regenerates plans for that style only; library change follows `T-RBL-06`.
- DoD: `P-82` integration tests for each rule (bump a version, observe exactly
  which rows are invalid).

### T-DATA-04 Fast path loader

- Closes: F-DATA-04, F-RUN-09.
- `loadFastPath(trackId, styleId, venueClass)` returns parsed and validated
  TrackModel and ShowPlan objects (or typed misses), from an in-memory LRU
  over the DB and artifact files, with timings recorded for `P-138`.
- DoD: unit and integration tests; the old path-as-`trackJson` bug has a
  regression test.

### T-DATA-05 Semantic validation of contracts

- Closes: F-DATA-05.
- Zod refinements and a validator module: beats strictly increasing and
  unique; ranges ordered; events inside duration; segment counts consistent
  between device, calibration and cell map; cue durations positive; section
  cover without gaps or overlaps where required. Validation runs at every
  trust boundary (worker output, DB read, IPC input).
- DoD: property tests generate invalid objects of each kind and expect
  rejection with a precise error path.

### T-DATA-06 Session recorder and exact replay

- Closes: F-DATA-06; probes `P-102-event-inspector`, `P-103-replay-exact`.
- Records, when enabled (`diagnostics.recorder.enabled`): DJ events and
  DeckStates (raw and normalized), provider status, show decisions (installs,
  overrides, director choices, mixer ownership), renderer frame hashes per
  tick, device health, errors, config changes. No audio. Storage in a bounded
  ring on disk (`diagnostics.recorder.maxMb`) with `.ndjson` export; no array
  `shift()` on large buffers.
- Replay: feeds the recording into the simulator providers and a recording
  transport with the same config snapshot; frame hashes must be identical.
- DoD: `P-103` (record 10 minutes of a SIM session, replay, 100 percent frame
  hash equality); a deliberately nondeterministic change fails it.

## 2. Security (T-SEC)

### T-SEC-01 Secrets in safeStorage

- Closes: F-DATA-07, F-CLD-01 (secret part).
- The Govee API key (and any future secret, such as an agent API token cache,
  which stays in memory only) is stored with Electron `safeStorage`; never in
  config files, logs, crash reports or the session recorder. Settings shows
  "stored" and a replace or remove action, never the value.
- DoD: round-trip test; log scan test proves the key never appears in logs
  after exercising the cloud client.

### T-SEC-02 Network exposure

- Closes: F-GOV-20 (binding part); probe `P-110-security`.
- Bind only necessary interfaces (`govee.lan.interfaces`, loopback for OSC
  and local sidecars), never listen on non-loopback addresses except the
  Govee UDP ports and discovery protocols that require it (PRO DJ LINK,
  Serato Remote Bonjour, OS2L), each listed with its reason in Diagnostics.
  No externally reachable control server by default (spec 110, 111); no
  command bridging to other networks.
- DoD: `P-110` port scan from another host shows only the listed listeners;
  a test proves the OSC listener refuses non-loopback by default.

### T-SEC-03 Electron hardening

- Closes: F-SEC-01, F-APP-05 (security part); probe `P-87-ipc-contract`.
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  a strict Content Security Policy (no remote scripts, no `eval`), navigation
  and new-window guards, `webSecurity` on, and both
  `session.setPermissionRequestHandler` and
  `session.setPermissionCheckHandler` (Web MIDI and media device enumeration
  consult the check handler, not only the request handler) granting only
  microphone or audio capture to the audio window and MIDI where used;
  everything else denied. The preload exposes the typed API from `packages/ipc` only (no generic
  `invoke(channel)`), and main verifies the sender frame for every message.
- DoD: Electron security checklist test (a script that loads the built app
  and asserts each setting); a malicious renderer script cannot call an
  unknown channel.

### T-SEC-04 Read-only access enforced by construction

- Closes: F-SEC-02; supports `P-4.1-readonly-library`.
- Rekordbox and Serato databases are opened with read-only flags (SQLite
  `readonly` and `query_only` pragmas, or the library's read-only mode) and
  audio and ANLZ files with read-only descriptors; the library service exposes
  no write method; a static rule forbids write APIs in the library package.
- DoD: tests attempt writes through every exposed handle and expect errors; a
  checksum of the fixture DB and files is identical before and after a full
  test run.

### T-SEC-05 Consent and audit for privileged helpers

- Closes: F-SEC-03 (with `T-LIVE-11`).
- A consent flow for the memory reader and any elevated helper: what it does,
  what it needs (re-signing Rekordbox, elevated privileges), the risks
  (notarization removed, updates may break it, security warning at launch),
  how to undo it, and an explicit opt-in stored with a timestamp. Every start
  of a privileged helper is logged to an audit list in Diagnostics.
- The app never performs the re-sign or elevation itself.
- DoD: E2E of the consent flow on SIM; audit entries recorded.

## 3. Operations (T-OPS)

### T-OPS-01 Environment facts

- Closes: support for every hardware runbook.
- Record in `docs/finish/evidence/T-OPS-01/environment.md`: the owner's Mac
  model, chip, macOS version, Rekordbox and Serato versions, FLX4 firmware,
  network (router, band, isolation settings), Govee units with SKU, hardware
  and firmware versions; and the Windows reference machine. The app's
  Diagnostics "Environment" panel shows the same facts from detection
  (Electron, Node, Chrome versions, OS, CPU).
- DoD: document and panel agree.

### T-OPS-02 Structured logging

- Closes: F-OPS-01; probe `P-130-log-schema`.
- Logger used by every process (main, show host, audio window, worker via
  forwarding) with the spec 130 fields (timestamp, monotonic timestamp,
  module, severity, session, deck, track, fixture, event, latency), JSON
  lines, rotation (`diagnostics.log.maxFileMb`, `diagnostics.log.files`),
  raw protocol logging only in diagnostic mode, rate limiting of repeated
  messages.
- DoD: `P-130` validates every line of a SIM session log against the schema;
  no raw protocol lines in normal mode.

### T-OPS-03 Metrics

- Closes: F-OPS-02, F-UI-11 (metrics part); probe `P-131-metrics`.
- Measure and expose all spec 131 metrics: DJ update rate, DJ state age,
  clock correction, beat error estimate, render time, renderer FPS, device
  FPS, superseded frames, device latency, analysis duration, planner duration,
  IPC latency; plus this plan's additions (queue drops per bounded queue,
  failover switches, fusion authority switches, missed watcher changes).
  Histograms with p50, p95, p99; Diagnostics reads them directly.
- DoD: `P-131` asserts every metric changes under SIM activity; no metric is
  a constant.

### T-OPS-04 Update strategy

- Closes: F-OPS-04; probe `P-145-unverified-banner` (with `T-LIVE-13`).
- Updates (electron-builder's updater or manual download, owner choice
  recorded) are checked only when `update.checkOnLaunch` is on and never
  installed while Live is active or a show is loaded (spec 145); dependency
  versions are locked (Yarn lockfile, `uv.lock`) and CI-tested.
- DoD: test that an available update during Live is deferred with a status
  notice and no modal.

### T-OPS-05 Packaging and the development launcher

- Closes: F-OPS-05, F-OPS-10, F-APP-16, F-ANA-22 (packaging),
  F-ANA-29 (packaging).
- Development: `yarn dev` starts Vite, compiles main and preload in watch
  mode, and launches Electron with the show host (one command).
- Packaging with electron-builder (DS-30, ADR-006): macOS (arm64 and x64 or
  universal, dmg and zip) and Windows (NSIS, x64 and arm64 if the native
  modules build). Includes: native addons rebuilt for Electron
  (govee-toolkit, better-sqlite3, @julusian/midi, BLE backend, any SQLCipher
  module) listed in `asarUnpack`; bundled `uv`, a pinned Python, the analysis
  project and its locked environment or an offline wheel cache; FFmpeg
  (license recorded); model weights only where their licenses allow, else
  downloaded in Setup with consent (`T-ANA-05`).
- macOS Info.plist (electron-builder `extendInfo`):
  `NSLocalNetworkUsageDescription` (LAN discovery prompt on macOS 15 and
  later), `NSBonjourServices` (`_SeratoIOSRemote._tcp` and the OS2L service
  type), `NSBluetoothAlwaysUsageDescription`, `NSMicrophoneUsageDescription`,
  and `NSAppleEventsUsageDescription` if the AX provider scripts System
  Events (`T-LIVE-06`).
- macOS hardened runtime entitlements (the app is not sandboxed, so App
  Sandbox entitlements such as network client and server or
  `com.apple.security.device.bluetooth` do not apply): the Electron set
  (`com.apple.security.cs.allow-jit`, and
  `com.apple.security.cs.allow-unsigned-executable-memory` if the Electron
  version in use still needs it), `com.apple.security.device.audio-input`,
  and `com.apple.security.automation.apple-events` when the AX provider uses
  Apple Events. Every nested Mach-O (uv, Python and every compiled extension
  in the bundled environment, FFmpeg, native addons, the privileged helper)
  is signed with the hardened runtime and our identity so library validation
  passes; `com.apple.security.cs.disable-library-validation` is used only on
  the Python executable and only if loading third-party extension modules
  proves it necessary, with the reason recorded in ADR-006.
- Windows: the NSIS-installed Win32 app declares no capabilities. Setup
  explains the firewall prompt for UDP 4001 to 4003 and the other listeners
  (`T-SEC-02`), and the Windows privacy settings for microphone access by
  desktop apps and for Bluetooth.
- Signing and notarization need an Apple Developer ID and a Windows
  certificate: spending money is an owner decision (`00` section 7). Build
  unsigned artifacts in CI regardless, and document the signed pipeline so it
  runs as soon as credentials exist.
- DoD: packaged builds for both OSes in CI; the smoke-install job
  (`T-TRU-11`) launches them and runs the headless checks; the ten-point
  PACKAGE item is proven per capability.

### T-OPS-06 Clean-machine install matrix

- Closes: F-OPS-06; probe `P-153-clean-install`.
- VMs or runners without Node, Python or developer tools: macOS (current and
  previous major) and Windows 11. Install, launch, run Setup in Simulator
  mode, prepare analysis (with the model download or the bundled models),
  analyze a fixture track, play the normal-night SIM scenario, quit, relaunch,
  confirm persistence.
- Hosted CI runners have Node, Python, uv and FFmpeg installed, so they are
  not clean machines. Use fresh VM images, or run the installed app as a
  separate user whose `PATH` contains none of them, and prove it: the
  evidence log starts with `command -v node python3 uv ffmpeg` (macOS) or
  `where node python uv ffmpeg` (Windows) returning nothing.
- DoD: `P-153` passes on every matrix entry with logs and screenshots, each
  log beginning with the absence check above.

### T-OPS-07 Crash handling and safe state

- Closes: F-OPS-09; probe `P-133-shutdown` (crash part).
- Safe-state policy (`ops.safeState.look`: `hold-last`, `ending-look`
  default, `blackout`): if the show host crashes, main restarts it (it
  restores deck worlds from the latest provider states and cached plans) and,
  until it is back, the govee-manager's watchdog applies the safe look; if
  the renderer crashes, nothing changes on the lights (`T-ARC-04`); if the
  worker crashes, `T-ANA-02` applies; if main crashes, the lights hold the
  last frame (devices keep their state) and the next launch offers a crash
  report stored locally (never uploaded).
- DoD: fault tests kill each process during a SIM show and measure time to
  recovery and the frames sent meanwhile.

## 4. Config keys added (added to `03` section 3.10)

`storage.sqlite.synchronous` (`NORMAL`), `storage.sqlite.busyTimeoutMs`
(5000), `ops.safeState.look` (`ending-look`).

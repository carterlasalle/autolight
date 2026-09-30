# 04. Target architecture (WP02)

This is what the finished system looks like. Every work package builds a part
of it. Where this document and SPEC section 86 differ, this document extends the
spec (the show host may run in a utility process, DS-07), it does not relax it.

## 1. Processes and threads

```text
┌────────────────────────────── Electron MAIN process ──────────────────────────────┐
│ services/                                                                         │
│   config-service        (registry, layers, persistence, change events)            │
│   storage-service       (Kysely over better-sqlite3 or node:sqlite, DS-06)        │
│   library-service       (Rekordbox reader DS-15, Serato library, watchers)        │
│   identity-service      (TrackId resolver chain DS-22)                            │
│   analysis-supervisor   (spawns and supervises the Python worker)                 │
│   provider-manager      (runs DJ providers, fusion DS-01, emits DeckState)        │
│   midi-service          (FLX4, DS-13)                                             │
│   matter-bridge         (talks to the Matter utility process)                     │
│   cloud-service         (optional Govee cloud metadata, never frames)             │
│   ipc-router            (typed channels only, sender checks)                      │
│   lifecycle             (startup and shutdown state machines, crash policy)       │
│                                                                                   │
│   ── MessagePort ──►  SHOW HOST (DS-07: worker thread here, or utility process)   │
└───────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────── SHOW HOST ──────────────────────────────────────────┐
│ clock (hrtime, 60 Hz, DS-08)                                                      │
│ deck worlds A..D: DeckState ingest (latest wins), estimator, cursor, loop/scratch │
│ installed TrackModel + ShowPlan per deck (generation-tokened)                     │
│ overrides (blackout, white, freeze, master, force low/high, resume)               │
│ adaptive director                                                                 │
│ show mixer (weights, ownership, translation, introduction)                        │
│ renderer (layer stack, spatial fields, colour pipeline, latency sampling)         │
│ output: govee-manager (LAN razer/colorwc, BLE, Matter via port, failover)         │
│ metrics + session recorder feed                                                   │
│ snapshot publisher (state for the UI at runtime.snapshot.uiRateHz)                │
└───────────────────────────────────────────────────────────────────────────────────┘

RENDERER (React UI)        observes snapshots, sends intents; owns no timing, no I/O
AUDIO WINDOW (hidden)      live audio capture and DSP (DS-14); streams features to show host
PYTHON WORKER (uv)         offline analysis; framed protocol; artifacts on disk
MATTER UTILITY PROCESS     matter.js controller (isolated; crashes do not touch the show)
OPTIONAL SIDECARS          rkbx_link (user-installed, GPL, never bundled);
                           clean-room memory reader helper (opt-in, elevated)
```

### Ownership rules (enforced by dependency-cruiser, T-TRU-04)

| Resource | Owner | Nobody else may |
| --- | --- | --- |
| Show clock and all show-time state | Show host | Advance or reset a cursor |
| Govee LAN sockets (4002 listener, control sockets) | Show host govee-manager | Bind 4001 to 4003 |
| BLE radio | Show host (or main if T-BLE-01 proves the backend needs the main thread; then frames cross a MessagePort with latest-wins) | Open GATT links |
| DJ provider sockets, OSC, MIDI, AX | Main services | Read DJ state directly |
| Database | Main storage-service | Open the DB file |
| Rekordbox and Serato libraries | Main library-service (read-only) | Open library files |
| Python worker | Main analysis-supervisor | Spawn Python |
| UI state | Renderer | Hold authoritative show state |

## 2. Data flow

```text
providers ──DeckState (generation, per-field source, age)──► provider-manager (fusion)
   │                                                               │
   │                                              latest-wins port │
   ▼                                                               ▼
library-service → identity-service → cache (TrackModel, ShowPlan) → SHOW HOST install
analysis-supervisor → Python → artifacts → cache
FLX4 midi-service → hints ─────────────────────────────────────────► SHOW HOST director
audio window → features (bounded, latest wins) ────────────────────► SHOW HOST overlay
SHOW HOST → govee-manager → sockets/BLE/Matter → lights
SHOW HOST → snapshot (bounded, latest wins) → main → renderer
renderer intents (typed) → main ipc-router → SHOW HOST (emergency path highest priority)
```

Every cross-boundary queue is bounded and latest-wins except command queues
for intents, which are small FIFO with explicit capacity from config and loud
overflow errors.

## 3. Package map (existing plus new)

| Package | Status | Contents after this plan |
| --- | --- | --- |
| `packages/contracts` | keep, extend | Zod schemas v2 (DeckState, TrackModel, ShowPlan, Fixture, Room, IPC), branded units, beat mapping |
| `packages/config` | new | Registry, layers, exports (WP01) |
| `packages/ipc` | new | Typed channel definitions shared by main, preload and renderer |
| `packages/dj-core` | keep | Weights, estimator primitives (moves logic to show-runtime where stateful) |
| `packages/rekordbox-library` | extend | Reader adapters (DS-15), ANLZ access helpers, watcher |
| `packages/rekordbox-live` | split | `providers/{rkbx-osc, lighting-ipc, prolink, ax, composite, memory, os2l}`, fusion, version registry, replay |
| `packages/serato` | extend | serato-connect adapter, GEOB, library |
| `packages/controller-flx4` | extend | MIDI backends, map data, state, hints |
| `packages/track-model` | extend | Identity resolver, readiness |
| `packages/analysis-client` | rewrite | Supervisor v2 |
| `packages/show-planner` | rewrite | Hierarchical planner, primitives, restraint, recurrence, colour |
| `packages/show-runtime` | rewrite | Clock, deck worlds, estimator, overrides, director |
| `packages/show-mixer` | rewrite | Weights, ownership, translation, introduction |
| `packages/venue` | rewrite | Room model, placements, spatial fields, groups, splits |
| `packages/renderer` | rewrite | Layer stack, primitive renderers, colour pipeline |
| `packages/govee` | rewrite | Manager, LAN engines, BLE, Matter client, failover, qualification, simulators |
| `packages/reactive-audio` | rewrite | DSP and overlay |
| `packages/storage` | rewrite | Kysely schema, migrations, drivers |
| `packages/diagnostics` | extend | Logging, metrics, recorder |
| `packages/simulator` | extend | Protocol simulators (Govee LAN, BLE adapter, rkbx OSC, ProLink, MIDI, Serato Remote, Lighting IPC replay) usable in tests and in explicit Simulator mode |
| `packages/show-host` | new | Worker entry, tick pipeline, MessagePort API |
| `apps/desktop/electron/services/*` | new | Main services listed in section 1 |
| `tools/capture` | new | Rekordbox, Serato, MIDI, Govee capture tooling |

## 4. Tasks

### T-ARC-01 Show host with all DS-07 modes

- Closes: F-APP-02 (with T-RUN-01), spec 56, 86, 108.
- Build `packages/show-host` with one entry that runs as: a `worker_threads`
  Worker created by main (`worker-thread`), an Electron `utilityProcess`
  (`utility-process`), and a utilityProcess whose tick pipeline runs on its own
  worker thread (`utility-process-worker`). Communication is always a
  `MessagePort` with a typed protocol from `packages/ipc`.
- Verify native addons load in each mode (govee-toolkit napi, BLE backend).
  Record results. If an addon cannot load in a mode, that mode reports
  `unavailable` with the reason in the Decision switches tab; do not silently
  pick another mode.
- DoD:
  1. `P-56-ui-freeze` passes in every available mode.
  2. Jitter measurement (T-ARC-06) recorded per mode under three loads: idle,
     renderer freeze, main-process synchronous DB burst of 500 ms.
  3. Killing the renderer process leaves the show host running; killing the
     show host triggers the crash policy (T-ARC-03) and an automatic restart
     that resumes the current look within `runtime.fastPath.budgetMs` plus
     restart time (measured).
- Metrics: tick interval p50, p99, max; missed ticks per hour; restart time.

### T-ARC-02 Typed IPC API

- Closes: F-APP-04, F-APP-05, F-APP-06, spec 87.
- Replace `apps/desktop/electron/ipc.ts` and `preload.ts` with
  `packages/ipc`: every channel has a request schema, a response schema, a
  version, and a handler signature. Preload exposes named functions only
  (`window.autolight.master.blackout()`, not `invoke(string, unknown)`).
  Register handlers before creating the window. Validate `event.senderFrame`
  origin. Errors return a typed `{ ok: false, error: { code, message } }` and
  are surfaced in the UI status area; no `.catch(() => undefined)`.
- Channel list (minimum): `master.{blackout, white, freeze, intensity, resume, forceLow, forceHigh}`,
  `show.{snapshot.subscribe, style.set, energy.force, trigger.build, trigger.drop, upcoming}`,
  `deck.{list, select}`, `library.{tree, tracks, track, analyze, queue, readiness}`,
  `inspector.{lanes, audition, corrections.*}`, `venue.{get, save, list, switch, room.*, fixture.*}`,
  `devices.{list, scan, identify, testChase, qualify.*, recalibrate, transport.set}`,
  `providers.{status, select, capture.*}`, `config.{get, set, reset, export, import, schema}`,
  `diagnostics.{metrics, logs, events.subscribe, recorder.*, resolver}`,
  `setup.{state, step.*}`, `audio.{devices, select, start, stop}`, `app.{version, environment}`.
  Each maps to a real handler; T-TRU-03 fails CI for any handler that
  returns its input or a constant.
- DoD: contract test enumerates channels and asserts request and response
  validation; `P-87-ipc-contract` passes; no string-typed invoke in renderer
  code (ast-grep).

### T-ARC-03 Startup, shutdown and crash policy

- Closes: F-APP-01, F-OPS-03, F-OPS-09, spec 132, 133.
- Startup state machine, stages exactly as spec 132, each with status
  (`pending`, `running`, `ok`, `degraded(reason)`, `failed(reason)`), timing,
  and UI display in Setup and the status bar. A failed optional stage (for
  example "Start chosen DJ adapter" with Rekordbox closed) degrades and the app
  continues; the stage retries per config.
- Shutdown on `before-quit` and window close: stop accepting UI actions, freeze
  director, send the configured ending look (`show.endingLook`: blackout,
  hold, dim to x, scene via ptReal), disarm and close streams, stop adapters,
  stop the Python worker, flush the DB, stop workers, exit. Each step has a
  timeout from config; timeouts are logged.
- Crash policy: uncaught exception in main or show host writes a crash record,
  sends a safe look (configurable, default hold last frame for
  `runtime.crash.holdMs` then dim), and restarts the show host.
- DoD: `P-132-startup` and `P-133-shutdown` pass; a forced show host crash
  test passes with measured recovery time.

### T-ARC-04 Snapshots and renderer reload survival

- Closes: F-APP-02, spec 108, 92.
- The show host publishes a snapshot (decks, cursors, sections, upcoming cues
  per deck, owner, weights, exact per-cell output colours before calibration,
  device health, metrics) at `runtime.snapshot.uiRateHz`, latest wins. Main
  forwards to subscribed renderers. On reload, the renderer resubscribes and
  renders within one snapshot interval.
- DoD: `P-108-reload` passes (zero frame gap at the transport while the window
  reloads 10 times); `P-92-snapshot-equals-output` passes (the per-cell
  colours in the snapshot the UI receives equal the frame handed to the
  recording transport for the same tick, before calibration); snapshot size
  and serialization time measured and under `runtime.snapshot.maxBytes`
  (config, measured receipt).

### T-ARC-05 Main services and layout

- Closes: F-APP-01, spec 83, 155.
- Create `apps/desktop/electron/services/` with the services in section 1, each
  with `start()`, `stop()`, `status()`. Move current logic out of
  `show-service.ts`, `follow.ts`, `govee-lan.ts` into the right service or the
  show host, then delete those files.
- Renderer layout per spec 83: `src/app`, `src/routes`, `src/components`,
  `src/features`, `src/styles`.
- DoD: dependency-cruiser rules encode the section 1 ownership table and the
  spec 155 arrows; CI green; `P-83-layout` passes.

### T-ARC-06 Clock strategies and jitter measurement

- Closes: spec 56, 117; DS-08.
- Implement the three timer strategies. Build a jitter harness that records
  every tick's scheduled and actual `hrtime` for N minutes and writes a JSON
  histogram. Run each strategy under the three loads of T-ARC-01.
- DoD: evidence JSON per strategy per host mode on macOS (and Windows via CI or
  owner runbook); default chosen from data and recorded in the receipt of
  `runtime.clock.timerStrategy`; p99 below 5 ms for the default.

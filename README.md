<div align="center">

# AutoLight

**An automated lighting designer for DJs — Rekordbox + Serato in, Govee RGBIC out.**

[![CI](https://github.com/carterlasalle/autolight/actions/workflows/ci.yml/badge.svg)](https://github.com/carterlasalle/autolight/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)
![Yarn](https://img.shields.io/badge/Yarn-4.9.2-2C8EBB?logo=yarn&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-desktop-47848F?logo=electron&logoColor=white)

[Quick start](#quick-start) · [How it works](#how-it-works) · [Follow modes](#follow-modes) · [Packages](#architecture) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

</div>

AutoLight is a local-first show-control engine for DJs. It reads which tracks are loaded on each deck, understands the DJ software's actual beatgrid, analyzes the whole song before performance, and generates a coherent lighting score for the entire track — the way a lighting designer would program it, not the way an audio visualizer flashes at bass.

## How it works

```mermaid
flowchart LR
    A[DJ software + track files] --> B[Musical understanding]
    B --> C[Lighting designer]
    C --> D[Lighting score]
    D --> E[Live show engine]
    E --> F[Fixture renderer]
    F --> G[Govee rig]
```

The application knows the whole song before the song plays. If a drop lands on beat 257, the engine knows it at beat 225 — so builds progress intentionally, darkness lands before impact, palettes evolve across phrases, and second drops vary from first drops.

| Principle | What it means |
|---|---|
| Future knowledge first | Whole-song plans from complete analysis, not beat-by-beat reactions |
| DJ beatgrid is timing truth | Rekordbox/Serato grids win; ML trackers only vote confidence |
| Analysis describes, planner directs | No DSP function can fire `STROBE()` directly |
| Lighting is hierarchical | Track → section → phrase → bar → beat → sub-beat decisions |
| Darkness is a state | Blackouts, negative space, and delayed reveals are programmed, not idle |
| Repetition needs purpose | Choruses repeat their visual language; randomness never does |

## Follow modes

No controller board is required in any mode. Transport comes from DJ software, never from the FLX4.

| Mode | Source | Accuracy | Needs |
|---|---|---|---|
| `preview` (default) | ANLZ grid + compiled plan | Beat-anchored, intro cursor | Nothing — works offline |
| `ax-beat` | Rekordbox screen time fields | Coarse (~1 Hz, ±1 beat) | Rekordbox open |
| `prolink` | PRO DJ LINK Virtual-CDJ capture | Beat-accurate | Link peer on the LAN |
| `soundswitch` | Lighting IPC capture | Sample-accurate | SoundSwitch 2.11+, Rekordbox 7.2.19+ |

Set it in Setup → DJ source. The UI shows honest empty states (`-- BPM`, `No show loaded`, `No lights`) until real decks, analysis, and discovered lights resolve — never mock tracks.

## Quick start

### Prerequisites

- Node.js `22` (see `package.json` engines)
- Yarn `4.9.2` (`packageManager` field)
- Python `3.12+` with [`uv`](https://docs.astral.sh/uv/)
- FFmpeg on `PATH`

```bash
git clone https://github.com/carterlasalle/autolight.git
cd autolight
yarn install --immutable
yarn build
yarn test
```

Run the Python analysis suite:

```bash
cd analysis && uv sync && uv run pytest
```

### Run the desktop app

```bash
cd apps/desktop
yarn dev        # Vite renderer at http://localhost:5173
```

Build all three Electron contexts (Vite renderer + esbuild main/preload):

```bash
yarn build
```

Then launch `dist/electron/main.cjs` with Electron. The app is local-first and offline-capable during performances: playback continues if the analysis worker crashes, and the renderer never blocks the show loop.

## Capabilities

<!-- capabilities:start -->
| Capability | Status | Missing |
| --- | --- | --- |
| Rekordbox live deck follow (live-follow) | PARTIAL | Lighting IPC decoder pending (T-LIVE-09); rkbx_link sidecar owner decision (OD-03); composite provider inputs not acquired (T-LIVE-07); apps/desktop/electron/follow.ts; apps/desktop/electron/show-service.ts |
| Rekordbox library reader (library) | PARTIAL | master.db reader not in app (T-RBL-01); ANLZ path resolution string math only (T-RBL-02); packages/rekordbox-library/src/index.ts |
| Analysis worker (analysis) | PARTIAL | codegen drift pipeline pending (JSON-Schema export plus datamodel-code-generator; interim drift check tools/trackmodel-drift.mjs in yarn truth); analysis/src/autolight_analysis/worker.py |
| Show planner (planner) | PARTIAL | 6-level hierarchy missing (T-PLAN-03); restraint 1 of 11 fields (T-PLAN-05); primitives 7 of 27 (T-PLAN-04); packages/show-planner/src/index.ts |
| Two-deck mixer (mixer) | PARTIAL | crossfader curve wrong (T-MIX-01); blackout ALL unhandled (T-MIX-04); packages/show-mixer/src/index.ts |
| Layer stack renderer (renderer) | PARTIAL | 8-layer stack missing (T-REND-01); Math.max compositing (T-REND-01); packages/renderer/src/index.ts |
| Govee LAN transport (govee-lan) | PARTIAL | toolkit not a dependency (T-GOV-01); razer encoder wrong (T-GOV-02); per-datagram spawn (T-GOV-04); packages/govee/src/index.ts; apps/desktop/electron/govee-lan.ts |
| Typed IPC (ipc) | PARTIAL | 24 channels typed (T-ARC-02 done); side-effect integration test pending (T-TRU-03); packages/ipc/src/index.ts; apps/desktop/electron/ipc.ts |
| Configuration registry (config) | PARTIAL | 240 keys visible (T-CFG-01/05 done); persistence pending (T-CFG-02); hardcoded values pending (T-CFG-04); packages/config/src/index.ts |
| Simulator mode (simulator) | PARTIAL | renderer toggle plus badge done (T-TRU-02); main handler plus loopback sim pending (T-GOV-14); packages/simulator/src/index.ts |
| Serato support (serato) | MISSING | serato-connect not a dependency (T-SER-01) |
| DDJ-FLX4 telemetry (flx4) | MISSING | no MIDI I/O (T-FLX-01) |
| BLE transport (ble) | MISSING | no BLE transport (T-BLE-01..10) |
| Matter control (matter) | MISSING | no Matter controller (T-MAT-01..04) |
| Room and venue mapping (room) | MISSING | no room editor (T-ROOM-03); no strip wizard (T-ROOM-04) |
| Storage service (storage) | PARTIAL | Store exists, never opened by app (T-DATA-01); packages/storage/src/index.ts |
| UI screens (ui) | PARTIAL | Settings added (T-CFG-05); waveform, corrections, room canvas missing; apps/desktop/src/renderer/ |
| Packaging (packaging) | MISSING | no electron-builder (T-OPS-05) |
| Verification harnesses (verification) | PARTIAL | E2E pure-model only (T-QA-02); no camera/soak/gates; apps/desktop/e2e/ |
<!-- capabilities:end -->

| Area | What AutoLight provides |
|---|---|
| DJ sources | Rekordbox library (read-only SQLCipher + WAL), ANLZ grids/phrases/cues/waveforms, Serato crates + Remote transport, FLX4 MIDI as secondary truth |
| Analysis | Python worker over framed-JSON stdio; native ANLZ wins timing, all-in-one + beat_this vote structure, stem DSP finds builds/drops/fake drops |
| Planning | Deterministic seeded plans (same track + style → same show), section contrast, motif recurrence, restraint + impact budgets |
| Runtime | Random-access show cursor, seek/loop/scratch handling, two-deck audible-weight mixing, fault-degraded clock that never cuts to black on one drop |
| Rendering | Venue-independent cues → per-fixture RGB frames, linear-light intensity, per-device latency compensation, newest-state-wins streams |
| Hardware | Govee H6076 + H1A45 over LAN (discovery → arm → stream), per-device FPS backoff, disconnect/reconnect re-arm, qualification wizard |
| UI | Electron + React + Tailwind v4 + shadcn/Radix; Live/Library/Inspector/Venue/Setup/Diagnostics; ⌘K palette; no-modal Live guarantees |

## Architecture

A Yarn workspace with deliberately narrow package boundaries:

```text
apps/
  desktop/                Electron shell (Vite renderer, esbuild main/preload)
packages/
  contracts/              Zod schemas: TrackModel, ShowPlan, DeckState, fixtures
  rekordbox-library/      Read-only library + ANLZ path math + phrase labels
  rekordbox-live/         Lighting/IPC + composite-FLX4 providers, replay harness
  serato/                 Crate parser + Remote snapshot → DeckState
  controller-flx4/        FLX4 MIDI map; hints only, never playhead
  track-model/            Canonical identity (native ID → path → hash → fingerprint)
  analysis-client/        Framed-JSON stdio bridge to the Python worker
  show-planner/           Deterministic whole-song lighting scores
  show-runtime/           Cursor, clock health, overrides, resume quantization
  show-mixer/             Two-deck blending + exclusive impact ownership
  renderer/               Plan + beat + fixtures → logical RGB frames
  venue/                  Shared coordinates, groups, orientation, qualification
  govee/                  LAN opcodes, coalescing, DeviceManager, calibration
  reactive-audio/         Controlled overlay (brightness/sparkle only, ≤20%)
  storage/                SQLite WAL cache with per-table version invalidation
  simulator/              Deterministic deck/fixture/fault harnesses for tests
  diagnostics/            Structured logs, metrics, session recorder
analysis/
  src/autolight_analysis/ Native ANLZ, DSP features, fusion, worker
protocol-fixtures/        Committed Lighting/IPC captures for replay tests
test-fixtures/analysis/   Real TrackModel/ShowPlan fixtures from the ANLZ cache
```

Timing truth flows one way: DJ beatgrid → beats (never seconds) → plan → cursor → mixer → renderer → transport. Analysis evidence never bypasses the planner, and live audio never restructures the show.

## Safety model

- Rekordbox database access is **read-only**, always.
- Blackout is RGB `0,0,0` — the stream stays armed, power is never cycled mid-show.
- One dropped packet never kills the rig: extrapolate → hold look → degraded clock.
- Emergency BLACKOUT is a toolbar button with a keyboard shortcut, never behind a modal.
- Unknown Rekordbox versions probe but are never declared supported until replay qualification passes.

The normative requirements are in [`docs/SPEC.MD`](docs/SPEC.MD). Architecture boundaries are in [`docs/architecture.md`](docs/architecture.md). Protocol work is logged in [`docs/rekordbox-capture.md`](docs/rekordbox-capture.md).

## Documentation

| Document | Purpose |
|---|---|
| [Specification](docs/SPEC.MD) | Full product/engineering contract (§1–§150) |
| [Architecture](docs/architecture.md) | Boundaries and timing-truth flow |
| [Rekordbox capture](docs/rekordbox-capture.md) | Lighting IPC capture matrix + live log |
| [Show planner](docs/show-planner.md) | Planning model |
| [Track model](docs/track-model.md) | Identity + coverage levels |
| [Govee](docs/govee.md) | LAN transport |
| [Qualification](docs/qualification.md) | Device qualification |
| [Contributing](CONTRIBUTING.md) | Development workflow and PR standards |
| [Agent guidance](AGENTS.md) | Repository-specific rules for coding agents |

## Contributing

Direct pushes to `main` are blocked; all changes land through pull requests with required checks. Read [CONTRIBUTING.md](CONTRIBUTING.md) before making changes. Run `yarn verify:phase1` before requesting review.

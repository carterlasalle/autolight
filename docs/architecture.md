# Architecture

SPEC.MD §155 owns the full boundary. Data flow:

```text
Rekordbox/Serato → DeckState + TrackModel → ShowPlanner → ShowPlan
→ ShowRuntime + ShowMixer → Renderer → VenueModel → Govee LAN streams
```

- Timing truth: DJ beatgrid (§2.2), beats not seconds (§73).
- Analysis describes music; planner directs the show (§2.3).
- Blackout = RGB 0,0,0, never power-off (§47).
- Transport: newest-state-wins, no stale queues (§49, §51, §149).

## Processes and threads

- **Electron main**: owns the DB file (`services/storage-service.ts`,
  DS-06 driver policy §80), session/metrics/live-transport state
  (`show-service.ts` §86 §132), AX 1 Hz poll + PRO DJ LINK observer,
  Govee manager, graceful shutdown order (§133, 9 steps).
- **Show host worker thread** (DS-07 default, SPEC §56): the 60 Hz tick
  pipeline (`packages/show-host/`: ingest/estimator/cursor/overrides/
  mixer/renderer/snapshot publisher) runs in `node:worker_threads` via
  `src/worker-entry.ts` on the monotonic `process.hrtime.bigint` clock.
  Spawned and owned by `ShowHostSupervisor`
  (`electron/services/show-host-supervisor.ts`, the only spawner); master
  intents flow main → worker through the typed host protocol
  (`setHostIntentForwarder`), jitter metrics (intervalP50/P99/max,
  missedTicksPerHour) flow back into `diagnostics/all` (§131). A frozen
  main thread stalls message delivery, never the tick (§86). Fallbacks:
  `utility-process`, `utility-process-worker` (ADR-004). Clock strategies
  (`interval` / `timeout-spin` / `hybrid`, DS-08) measured by
  `tools/jitter/jitter.mjs` (T-ARC-06).
- **Analysis worker**: Python over framed stdio, owned solely by
  `services/analysis-supervisor.ts` (requeue on crash, SPEC §109).
- **Matter utility process** (planned): controller isolated from the show
  (see `services/matter-bridge.ts`, ADR-011).

## Boundaries (enforced by `.dependency-cruiser.cjs`)

- Renderer observes snapshots and sends intents; never imports
  show-runtime, show-mixer, renderer internals, govee, or simulator
  (`renderer-no-show-internals`).
- Planner never imports govee or venue device internals (venue
  independence).
- Show host owns time, output, and UDP sockets. Main owns the DB file.
  Python worker owns analysis artifacts.

## Key decisions

- ADR-001/002: Rekordbox live-follow (`followMode`: preview / ax-beat /
  prolink / soundswitch) and fusion provider ranking (DS-01).
- ADR-003: Govee engines (`toolkit` / `native-ts` / `auto`) and hybrid
  failover.
- ADR-004: show host placement (worker-thread default) and hybrid clock.
- ADR-011: Matter descoped to opt-in whole-fixture fallback.
- ADR-012: native TypeScript razer codec instead of a vendor fork.

# T-QA-04: Simulators and fault injection at application level

Closes F-QA-05, F-QA-12 (with T-GOV-14).

## What changed

- `apps/desktop/electron/services/fault-injection.ts` (new): `runFaultSuite`
  drives a `FramePort` (production wires `deliver` to the govee-manager
  frame path; tests wire it to a recording array) through every spec 105
  to 109 scenario: dj-silence (holds current look, never all-off), device
  disconnect / worker-kill / host-kill (others continue, one-frame
  recovery), latency / loss / throttle (newest-wins, superseded counted,
  logical show still ticks), duplication / reorder (resolve to one current
  frame), port-conflict / multicast-blocked (discovery-plane, frames keep
  flowing, counted separately), malformed (dropped and counted),
  renderer-reload (zero gap). Zero stale frames by construction; pending
  depth never above 1. `FaultInjectionService` wraps the runner with
  delivered / superseded / staleFrames / scenario counters in status.
- No UDP in this file: Govee sockets stay owned by the show host
  govee-manager; the simulator package is never imported
  (dependency-cruiser renderer-no-simulator stays green).

## Proof

Run from the repo root (scoped config lives in this folder because the
desktop vitest config collects `src/**` only and is outside this slice):

```sh
yarn vitest run --config docs/finish/evidence/T-QA-04/vitest.scoped.config.ts --root /Users/rocket/autolight
```

Result: 2 files passed, 13 tests passed (7 fault suite, 6 secrets-service).
`tsc --noEmit -p tsconfig.typecheck.json` in `apps/desktop`: zero errors
in `fault-injection.ts`, `fault-injection.test.ts`,
`secrets-service.ts`, `secrets-service.test.ts`.

## Delete test

Change `staleFrames: 0` to count delivered-during-disconnect frames and
the disconnect test goes red. Remove the newest-wins skip in the throttle
branch and the congestion test goes red (pending grows, slow device
delivers 120 instead of 30). Deliver `"held"` as `"current"` during
silence and the hold test goes red.

## Remaining seams

- Wire `deliver` to the real govee-manager frame path in Simulator mode
  and run the suite as the application-level E2E `P-104` (needs the show
  host slice).
- Wire the vitest config to collect `electron/services/*.test.ts` (config
  file is outside this slice; Main owns the decision).
- Config keys for scenario parameters (`qa.faults.*` maps) once the
  catalog export flow takes them.

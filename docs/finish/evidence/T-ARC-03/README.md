# T-ARC-03: Startup, shutdown and crash policy

Closes F-APP-01, F-OPS-03, F-OPS-09. Probes P-132/P-133/P-87 and the
delete test below are the acceptance evidence.

## What was wrong

- `electron/main.ts` declared `STARTUP_ORDER` and `SHUTDOWN_ORDER` arrays,
  but `boot()` only created a window, registered IPC, started AX polling and
  a ProLink listener. No startup state machine, no per-stage status or
  timing, no shutdown path at all. `quitApp()` was never registered on
  `before-quit`.
- No crash record, no safe look, no show host restart.

## What changed

- `electron/main.ts` keeps the spec 132 `STARTUP_ORDER` (11 stages:
  db, show-worker, govee, dj-adapter, library, analysis, venue, tracks,
  plans, arm, ready) and the spec 133 `SHUTDOWN_ORDER` (8 steps:
  freeze-ui, ending-look, disarm, dj-adapters, analysis, flush-db,
  workers, exit). `nextStage()` still derives the next pending stage.
- `electron/show-service.ts` gained the lifecycle runtime:
  `stopAxLoop()` / `stopProlink()` (symmetric with the existing starters;
  `quitApp()` now uses both), `setShowAcceptingUi()` /
  `isShowAcceptingUi()` (`E_SHUTDOWN`-style freeze gate for step 1,
  flipped once per process lifetime), `crashRecordPath()`,
  `applyCrashPolicy({ holdMs })` (safe look: hold the last frame for
  `runtime.crash.holdMs`, then dim to off), `restartShowHost()` (stops and
  restarts the AX/prolink observers feeding the host), `applyEndingLook()`,
  and `runShutdown({ timeoutMs, onStep })` (each step raced against a
  per-step timeout; timeouts and step errors are logged to the session
  recorder as `shutdown/step-timeout` / `shutdown/step-error`; shutdown
  always continues to the next step).
- `boot()` wires the policy: `app.on("before-quit")` and `win.on("close")`
  both run `runShutdown` with per-step timeouts, then `quitApp()` exits;
  `process.on("uncaughtException")` writes a crash record (timestamp, pid,
  Electron/Node versions, stack) to `crashRecordPath()` under userData,
  sends the safe look, and restarts the show host.
- No echo handlers introduced: every IPC handler in `electron/ipc.ts`
  still maps to a real show-service function. The sender check
  (`senderAllowed`, file:// or localhost:5173) is untouched; preload is
  read-only for this task (typed named API, no generic invoke).

## Proof

- `yarn --cwd apps/desktop exec tsc --noEmit -p tsconfig.json`: clean.
- `node scripts/build-main.mjs`: bundles `dist/electron/main.cjs`.
- Built-bundle probe (electron stubbed, `boot()` skipped): 12/12 checklist
  assertions pass (11 startup stages in spec order, 8 shutdown steps in
  spec order).
- Journey `m1-slice` steps 2 (P-132 stages in order with timings) and 11
  (P-133 ending look, disarm, flush) exercise this path end to end.

## Delete test

Delete any entry of `STARTUP_ORDER` or `SHUTDOWN_ORDER` and the
m1-slice step 2 / step 11 assertions go red (order and length are
asserted). Remove a `runShutdown` step or a per-step timeout race and the
`shutdown/step-timeout` recorder path plus the journey step 11 assertion
go red. Revert `applyCrashPolicy` to a no-op and the safe-look recorder
events (`crash/safe-look`, `crash/dimmed`) disappear from diagnostics.

## Remaining work (not claimed done)

- Per-stage pending/running/ok/degraded/failed status with timing, retry
  per config, and Setup/status-bar display (needs T-ARC-05 services and
  T-UI-14 surfaces; the machine runs stages through the real starters
  today).
- Simulator-mode fixture assertions (P-132/P-133 full E2E) belong to the
  T-QA-02 harness, not this slice.
- `show.endingLook` variants (hold, dim to x, scene via ptReal) beyond the
  current blackout default (T-ARC-05 govee-manager).

# T-OPS-07: Crash handling and safe state

Closes F-OPS-09; probe `P-133-shutdown` (crash part); wp14 section T-OPS-07;
spec 133; config `ops.safeState.look` (`ending-look` default).

## What changed

Nothing new in this slice: the crash policy already exists in
`apps/desktop/electron/services/lifecycle.ts` (`applyCrashPolicy`,
`crashRecordPath`, `SHUTDOWN_ORDER`, `runShutdown`) with `T-ARC-03`
evidence covering startup, shutdown and crash. This slice verifies the
safe-state mapping against the wp14 contract and records it.

- Safe-state mapping: show host crash restarts it (deck worlds restore
  from latest provider states plus cached plans) while the govee-manager
  watchdog holds the safe look; renderer crash changes nothing on the
  lights; worker crash follows T-ANA-02; main crash holds the last frame
  on devices and the next launch offers the locally stored crash report
  (never uploaded).
- `runtime.crash.holdMs` (2000 ms default) is the hold before the dim
  phase; `ops.safeState.look` selects `hold-last`, `ending-look`
  (default) or `blackout`.

## Proof

- Existing suite: `yarn workspace @autolight/desktop exec vitest run
  src/app/services.test.ts` gives 17 passed, including the lifecycle
  start/stop, shutdown-order and crash-policy cases owned by T-ARC-03.
- `applyCrashPolicy` writes the crash record, holds the safe look,
  restarts the show host, and dims after `holdMs` (lifecycle.ts
  implementation, exercised by the T-ARC-03 tests).
- Fault-injection timing (kill each process during a SIM show, measure
  recovery time and frames sent meanwhile) belongs to T-QA-04; no timing
  is claimed here.

## Delete test

Delete `applyCrashPolicy` and the T-ARC-03 crash tests fail to import.
Remove the dim timeout and the held-then-dimmed sequence never completes.

## Seams

The govee-manager watchdog applying the safe look during host restart is
the runtime half; this task records the policy. Crash reports stay local.

# T-QA-05: Performance harness

Closes F-QA-05; probe `P-117-perf`.

## What changed

- `packages/storage/src/perf.ts` (new): the harness core.
  - `measureTickJitter({ hz, durationMs, stallMs, stallAtTick })`: a
    drift-corrected tick loop that records how late each tick fires against its
    slot on the original grid, with an injectable stall so a red run can prove
    the report sees one. `stallDetected` is the assertion helper.
  - `timeSamples(fn, count)`, `percentile`, `summarise(name, unit, samples, {
    threshold, statistic })` and `notMeasured(name, unit, threshold, reason)`:
    a quantity the harness cannot measure in the current process is reported as
    not measured with its reason, never as zero.
  - `defaultThresholds()` carries the spec 117 and 118 numbers (tick jitter p99
    under 5 ms, UI frame time and render p95 under 16.7 ms, emergency request to
    send p99 under 100 ms, queue depth at most 1) and `relaxThresholds(t,
    slack)` applies `qa.perf.ciSlack` for CI runs.
  - `createMeasurementFile` and `writeMeasurement` produce `measurement.json`
    with the machine description, runtime versions, app name and version, the
    config snapshot hash, the command used, the applied slack, the thresholds
    and every measurement with p50, p95, p99 and max.
- `packages/storage/src/perf.test.ts` (new, 6 tests) wires the harness to the
  real components: the renderer (`renderFrame` with a 2,000 cell fixture), the
  channel contracts (`show/live` request and response schemas from
  `@autolight/ipc`), the DJ path (`estimatePosition` from `@autolight/dj-core`),
  the emergency frame path (`blackoutPayload`, `encodeRaw`, `envelope`) and the
  frame coalescer queue depth. It writes `measurement.json` into this evidence
  folder (`AUTOLIGHT_PERF_OUT` overrides the path).

## Proof

- `node_modules/.bin/vitest run --silent=false --reporter=verbose` from
  `packages/storage`: 7 files, 46 tests passed. The harness rewrites
  `measurement.json` on every run, so the values below are read from the file
  next to this README, not typed in by hand:
  - `showHost.tickJitter n=121 p50 0.46 p95 1.21 p99 1.27 max 1.28 ms`
  - `showHost.tickJitterWith20msStall n=201 p50 0.70 p95 10.82 p99 18.81 max
    20.81 ms` (the DoD red run: the injected stall is visible and this entry
    fails by construction)
  - `render.perTick2000Cells n=200 p50 1.29 p95 1.93 p99 3.27 max 4.86 ms`
  - `ipc.roundTrip n=200 p50 0.01 p95 0.01 p99 0.10 max 0.33 ms`
  - `dj.messageProcessing n=500 p50 0.00 p95 0.00 p99 0.00 max 0.05 ms`
  - `emergency.requestToSend n=200 p50 0.00 p95 0.01 p99 0.07 max 0.14 ms`
  - `queue.maxDepth n=1 max 1 frames`
  - `ui.frameTimeLive not measured` (reason recorded in the file: it needs a
    renderer frame source)
- `measurement.json` is committed next to this README, and the test asserts it
  parses back with a machine description, an app version, a config hash and the
  command used. The only failing entry in it is the injected stall; the
  test asserts exactly that list, so a harness that stops seeing stalls goes
  red.
- The thresholds recorded in this file are relaxed by `qa.perf.ciSlack` (3)
  because the run happened with `CI` set in the environment; the file records
  `ciSlack` so a reader can tell. The machine is the Apple M1 Pro used for
  development, not the reference machine.
- Spec 117 targets themselves are blocking checks owned by T-ARC-06 (jitter),
  T-REND-07 (render time), T-UI-13 (UI frame time) and T-UI-03 plus T-RUN-07
  (emergency latency), which is why this harness records the numbers and their
  pass flags instead of asserting machine-dependent timing in its own tests.
- Simulator runs prove code, never hardware; no hardware claim is made here.

## Delete test

Delete the `stallMs` injection and the stall test can no longer produce a red
jitter report, so the harness proves nothing about sensitivity. Delete
`notMeasured` and a quantity that cannot be measured in process silently
becomes `pass: false` with zero samples, indistinguishable from a real failure.
Delete `writeMeasurement` and the file assertions fail, so P-117 has no
artifact. Delete the `timeSamples` loop's second read of the clock and every
sample collapses to zero, which the queue and render assertions catch. Delete
`relaxThresholds` and the CI slack test fails, so CI runs would be compared
against the reference machine.

## Remaining work (not claimed done)

- The 10-minute PR job and the full runs on the reference Mac (and the Windows
  reference machine once OD-12 names it) are CI and milestone-exit wiring
  (`T-QA-01`, `T-TRU-11`); this slice ships the harness, its thresholds and its
  artifact.
- UI frame time on Live needs the E2E harness (`T-QA-02`) to sample frames in
  the packaged app; the measurement is declared here with its reason so no one
  reads a missing number as a pass.
- The IPC number measures the contract validation and serialization work, not
  the Electron transport; the end-to-end request to response measurement
  belongs to the E2E harness.

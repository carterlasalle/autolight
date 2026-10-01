# T-ARC-06: Clock strategies and jitter measurement

Closes spec 56, 117; DS-08.

## What changed

- New `packages/show-host/src/clock.ts`: three DS-08 timer strategies behind
  one `startClock(strategy, options)` entry point. All strategies anchor
  scheduled times to the start instant so phase never walks; only the wait
  mechanism differs:
  - `interval`: drift-corrected `setInterval`; missed ticks are skipped by
    re-anchoring to start.
  - `timeout-spin`: `setTimeout` coarse wait plus a busy-wait tail covering
    the last `runtime.clock.spinWindowMs`.
  - `hybrid` (default): `Atomics.wait` coarse sleep plus a spin tail for the
    last `spinWindowMs`; on threads where `Atomics.wait` is forbidden it
    takes the same shape as `timeout-spin`. Runs in the show host worker
    thread where `Atomics.wait` is allowed.
- Jitter per tick is `actual - scheduled` in ms floored at zero, using the
  same `hrtime` source and the same nearest-rank quantile pick as
  `ShowHost.getMetrics` (shared via `summarizeJitter`). Missed ticks use the
  same `MISSED_TICK_SLACK` (1.5x nominal) rule as the host tick pipeline.
- New `packages/show-host/src/clock.test.ts`: quantile check plus per
  strategy firing order, phase anchoring, non-negative jitter, validation,
  and idempotent stop.
- New `tools/jitter/jitter.mjs`: runs each strategy in a worker thread at
  60 Hz while loads block the parent (DS-07 worker-thread shape: parent
  stalls must not move worker phase). Loads are the three T-ARC-01 loads:
  `idle`, `renderer-freeze` (5 s parent stalls, per `P-56-ui-freeze`),
  `db-burst` (500 ms parent stalls). Writes a JSON report with one result
  per strategy per load, each holding `ticks`, `p50Ms`, `p99Ms`, `maxMs`,
  `missedTicks`, and a 0.5 ms bucket `histogramMs` (plus a 20 ms overflow
  bucket) over all ticks in the run.

## Measured table shape

Each `results[]` entry in the harness JSON:

```json
{
  "strategy": "hybrid",
  "load": "renderer-freeze",
  "hostMode": "worker-thread",
  "ticks": 18000,
  "p50Ms": 0.31,
  "p99Ms": 1.12,
  "maxMs": 6.40,
  "missedTicks": 2,
  "histogramMs": [{ "lo": 0, "hi": 0.5, "count": 16500 }]
}
```

## First measurement

No full run has landed in this checkout yet (runs take N minutes per
strategy per load and need a quiet host). The owner or CI run that fills
this table is:

```sh
yarn workspace @autolight/show-host build
node tools/jitter/jitter.mjs --minutes 5 --tickHz 60 --spinMs 1.5 \
  --mode worker-thread --out docs/finish/evidence/T-ARC-06/jitter.json
```

Windows coverage uses the same command with `--mode utility-process`
via CI or the owner runbook. Simulator runs prove code timing only and
never qualify as hardware receipts.

## Run reasoning

- Default stays `hybrid` unless the table says otherwise: hybrid wins when
  its p99 is strictly lowest under `renderer-freeze` and `db-burst`;
  otherwise the winning strategy becomes the default and this README plus
  the `runtime.clock.timerStrategy` catalog receipt are updated to match.
- Acceptance target: default strategy p99 below 5 ms in every load and
  host mode. On landing, the `runtime.clock.timerStrategy` receipt changes
  from `unmeasured (T-ARC-06)` to the measured p99 (for example
  `T-ARC-06 hybrid p99 1.1 ms`), and `runtime.clock.spinWindowMs` is set to
  the spin window the winning run used.

## Delete test

Delete any strategy from `TIMER_STRATEGIES` and `clock.test.ts` plus
`tools/jitter/jitter.mjs` go red (unknown strategy). Revert the interval
drift correction to a bare counter and a 5 s `renderer-freeze` run shows
phase walk in `maxMs`. Remove the `Atomics.wait` fallback branch and the
hybrid path throws on threads that forbid it instead of matching the
timeout-spin shape.

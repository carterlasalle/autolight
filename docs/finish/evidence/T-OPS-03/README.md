# T-OPS-03: Metrics

Closes F-OPS-02 and the F-UI-11 metrics part; probe `P-131-metrics`; wp14
section T-OPS-03; spec 131.

## What changed

- `packages/storage/src/metrics.ts` (new): `MetricsRegistry` measures and
  exposes all spec 131 metrics (DJ update rate, DJ state age, clock
  correction, beat error estimate, render time, renderer FPS, device FPS,
  superseded frames, device latency, analysis duration, planner duration,
  IPC latency) plus this plan's additions (queue drops per bounded queue,
  failover switches, fusion authority switches, missed watcher changes).
  Histograms report p50, p95, p99 over a 512-sample window. The snapshot
  only contains metrics with at least one sample, so no metric reads as a
  constant before it is exercised. Diagnostics reads the snapshot directly.
- Re-exported from `packages/storage/src/index.ts`.

## Proof

- `packages/storage/src/ops.test.ts` (metrics block, 3 tests): every spec
  131 name plus all 4 additions present in `METRIC_NAMES`; 100 render-time
  samples give count 100 with p50 below p95 below-or-equal p99 and a later
  sample moves max; discrete counters start absent (never constant zero)
  and appear after counting, per label.
- `yarn workspace @autolight/storage run test`: 10 files, 73 tests passed.

## Delete test

Remove a spec name from `METRIC_NAMES` and the coverage test fails.
Return snapshot entries for unobserved metrics and the empty-snapshot
assertion fails. Cap the window at 1 and the p50/p95 ordering test fails.

## Seams

Producers (show host tick, render loop, device links, analysis
supervisor, IPC router, watcher) call `observe` and `count`; Diagnostics
renders `snapshot()`. P-131 asserts every metric moves under SIM activity.

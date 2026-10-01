# T-ANA-02: Supervisor, persistent job queue and the preanalysis queue

Closes F-ANA-20; probes P-14-kill-worker, P-139-queue; spec 109, 139.

## What changed

- `packages/analysis-client/src/protocol.ts` (new): frames with `v`, request
  `id`, job records with states exactly `Queued`, `Analyzing`, `Compiling`,
  `Ready`, `Failed`; typed `AnalyzeErrorCode` (`audio-missing`,
  `native-unreadable`, `dsp-fallback`, `worker-exited`, `worker-timeout`,
  `spawn-failed`); `parseFrame`, `frameId`, `toJob`, `classifyError`.
- `packages/analysis-client/src/index.ts`: `AnalysisClient` is now the
  supervisor port. `uv` command with an absolute resolved project dir (never
  relative), job inputs kept whole (track id, audio path, native path,
  requested stages, config hash) so requeue is identical, deck-priority jobs
  jump the queue, per-job timeout (`analysis.worker.jobTimeoutMs`), cancel by
  id, heartbeat watchdog, restart with bounded exponential backoff
  (`analysis.worker.restartBackoffMs`), progress callback.
- Persistent database queue (`analysis_jobs`, T-DATA-02) remains the desktop
  layer's store; this package owns the in-process queue and job record shape.

## Proof

- Contract tests in `packages/analysis-client/src/index.test.ts` cover the
  complete/failed/requeue shapes; mid-flight yarn runs were skipped per the
  wave contract, so the vitest pass has to be taken at phase verification:
  `yarn workspace @autolight/analysis-client test`.
- Python side: malformed/typed failure frames proven by T-ANA-01 tests.

## Delete test

Delete the exit-handler requeue block and a mid-job kill loses the job;
delete `resolveProjectDir` and the relative-path regression returns (S24).

## Seams

- `apps/desktop/electron/services/analysis-supervisor.ts` constructs
  `new AnalysisClient(command, projectDir)`; its injected-fake tests keep
  passing because the constructor and method names are unchanged.
- P-14-kill-worker and P-139-queue UI probes are owned by T-UI-05 and the
  ops harness, outside this slice.

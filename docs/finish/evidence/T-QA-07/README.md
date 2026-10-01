# T-QA-07 Track-sync qualification matrix

Closes F-QA-05; probe P-119-sync-matrix.

## What changed

- `tools/qa/sync-matrix.mjs` (new): runs the 20 spec 119 manipulations (normal, pitch +-8/16pct, play/pause, cue restart, hot cue, seeks, 4/1-beat loops, 1/2 loop, 1/4 roll, scratch, reverse, sync toggle, two decks, crossfade, incoming track, master switch, track replace) on SIM against simulator ground truth; per-row p95 beat error against `qa.sync.maxBeatErrorMs` (20 ms).
- `sync-matrix.json` (in this folder): the SIM provider table.

## Proof

- `node tools/qa/sync-matrix.mjs`: 18/20 PASS; `pitch+16pct` and `pitch-16pct` FAIL (p95 ~27.6 ms over the 20 ms bound). The matrix proves it can show FAIL instead of hiding it; failing rows stay FAIL in capability status per the task DoD.
- Deterministic LCG seeds: reruns give identical tables.

## Delete test

Change the threshold to 30 and the two FAILs flip to PASS, which is why the threshold is read from the registry key name in the report, not hidden. Drop a row from ROWS and the row count assertion (20) fails.

## Seams / runbooks

- Per-provider tables for real providers and `HW-SYNC-01` (spec 119 matrix on real software, camera measurement) remain: BLOCKED-HARDWARE.
- Beat-error estimation wiring to the real estimator (`T-RUN-02`) is that task's step; this matrix uses scripted SIM inputs.

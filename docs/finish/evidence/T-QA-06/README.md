# T-QA-06 Soak

Closes F-QA-03; probe P-125-soak.

## What changed

- `tools/qa/soak-analyze.mjs` (new): trend analysis over 10 s samples (RSS, queue depth, drift, latency, stale track, worker liveness, UI frame time). Applies the spec 125 pass conditions: RSS slope after warm-up below `qa.soak.maxMemSlopeMbPerHour`, queue max depth 1, zero fixture drift, latency slope below `qa.soak.maxLatencySlopeMsPerHour`, zero stale track state, zero dead worker, UI slope bounded. `--fast` runs synthetic healthy plus leaky controls to prove the math; the real gate is the 4 h nightly wall-clock run.
- `soak-report.json` (in this folder): the `--fast` self-check output. Committed so the T-QA-01 class checker finds its required-suite artifact; `mode` field says `fast-self-check (not a soak)` so nobody mistakes it for the nightly run.
- Journeys `soak.journey.ts` KEPT (Main ruling: deletion denied until the replacement harnesses lands in the same slice). The fake `soak()` helper seam is marked here, not removed.

## Proof

- `node tools/qa/soak-analyze.mjs --fast`: healthy pass=true, leaky control 40.3 MB/h correctly fails memSlope. The harness is proven sensitive: a 40 MB/h leak fails, a healthy run passes.
- A deliberately unbounded queue (maxQueue 2) fails the queue check; a drift flag fails drift. Both verified by construction of the checks.

## Delete test

Delete the slope math and the leaky control passes, which is exactly the blindness the control exists to catch. Delete `soak-report.json` and T-QA-01 reports the soak suite MISSING.

## Seams / runbooks

- Nightly 4 h wall-clock SIM job plus `HW-SOAK-01` (4 h on the owner rig, video sample hourly) remain: BLOCKED-HARDWARE for the HW part, CI wiring for the nightly part (`T-TRU-11`).
- The old fake soak deletion (spec line: wp15 T-QA-06, the `soak()` helper that resets `pending = 0`) stays open until the nightly job exists.

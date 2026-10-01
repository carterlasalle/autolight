# T-REND-07: Renderer performance

Supports spec 117 (renderer part); budget `render.tickBudgetMs` (default 4 ms)
for one tick's evaluate plus mix plus render over 2,000 cells and two decks.

## What changed

No source changed. The mixer (`mixDown`), blend, and renderer paths this
task measures are owned by wave-1 evidence (T-MIX-01..06, T-REND-01) and the
room slice's in-flight renderer work; changing them here would collide. This
task contributes the measurement the DoD asks for: a benchmark JSON in this
evidence folder, taken against the current tree on the development machine.

## Proof

- `benchmark.json` next to this README: 200 ticks, 2 fixtures x 1,000 cells
  (2,000 cells), two decks with section-look plus chase plus build cues mixed
  through `mixDown` then `renderFrame`, Apple M1 Pro, Node v22.22.2:
  p50 4.24 ms, p95 6.07 ms, p99 9.94 ms, max 17.13 ms against the 4 ms budget.
- Verdict: OVER budget on this machine (p50 already above 4 ms). The profile
  is dominated by per-cell `resolveTarget` plus `Map` lookups and per-tick
  `orderIndex` construction in `renderFrame`; T-REND-05 (dense arrays, cached
  selector resolution, no per-frame allocation) is the fix that moves this
  number, and it is in flight with the room slice. Re-run this benchmark
  after T-REND-05 lands; the command is recorded in the JSON (`command`).
- Cross-check: the T-QA-05 harness measured the 2000-cell per-tick benchmark at p50
  1.29 ms / p95 1.93 ms on the same machine for `renderFrame` alone with one
  cue set and no mixer; the gap to this task's number is the two-deck
  mix-down plus the three-cue active set plus fixture-group resolution, which
  is the realistic tick this DoD names.

## Delete test

There is no source to delete-test here by design (see above). The benchmark
fails closed: any reader comparing `budgetMs` against `p50`/`p95` sees red
until T-REND-05 lands and the number is re-measured.

## Seams

- Reference Mac and Windows numbers are still missing: this file records the
  M1 Pro development machine only. The qualification owner re-runs on both
  reference machines at milestone exit.
- Zero steady-state allocations could not be asserted: there is no allocation
  counter in the current harness. T-QA-05 owns harness counters; re-measure
  allocations when it can count them.

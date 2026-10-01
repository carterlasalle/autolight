# T-ANA-16: Analysis goldens and detection metrics

Closes F-ANA-26, F-QA-10.

## What is in place

- `analysis/tests/fixtures/make_tracks.py`: deterministic planted-event
  generator with ground truth for builds, drops (including the verse re-entry
  slam), fake drops, breakdowns, re-entries, vocal entry/exit, fills, pauses,
  silences, transitions, final hit and outro release, plus `render_wav` and a
  WEAKEN=1 switch that flattens jumps and removes the ML/fill inputs.
- `analysis/tests/test_events_full.py`: per-type recall and precision inside
  `qa.events.toleranceBeats`, a planted-detection test, and a flat negative.
- Measured on the generated set (this tree): 18 event types planted, every
  type recall 1.0, 26 found with 26 true positives, micro precision 1.0.
  Red run reproduced: `WEAKEN=1 uv run pytest tests/test_events_full.py -q`
  fails 2 tests; the full suite is green without WEAKEN (85 passed).

## Not delivered (gap)

- Goldens for the generated and curated validation tracks, the committed
  metrics JSON in this evidence directory, and the config-driven
  `qa.events.minRecall` / `qa.events.minPrecision` gate are NOT written; the
  suite currently asserts per-type recall 1.0 and micro precision >= 0.9,
  which is stricter than the registry default placeholders but not the final
  per-type config gate.
- The five structured real-track models with zero events have not been
  regenerated; that needs the T-QA-09 curated tracks and the golden tooling.

## Delete test

With WEAKEN=1 planted recall collapses and the suite goes red (proven above);
delete a detector and its planted type recall drops to zero.

## Seams

- Curated validation tracks are T-QA-09 owner-supplied and opt-in in CI.
- Golden updates go through `yarn golden:update --reason` (T-TRU-15).

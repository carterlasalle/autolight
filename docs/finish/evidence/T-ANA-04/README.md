# T-ANA-04: Every input shape produces the right model or a typed failure

Closes F-ANA-02, F-ANA-03, F-ANA-23.

## What changed

- `worker.analyze_job` routes shapes: audio plus ANLZ runs the full pipeline;
  ANLZ without readable audio builds a STRUCTURED model from native data;
  neither returns a typed `failed` with reason `audio-missing` (never
  `complete`); audio without ANLZ runs decode plus ML and labels the grid
  `source: ml (not a DJ grid)`, falling back to an honest ADAPTIVE model with
  an empty grid when no beats are found.
- `schema.py`: adaptive requires an empty grid and structured/full require a
  non-empty one, so the empty-grid artifact the old TS `beats.min(1)` rejected
  is valid for ADAPTIVE and invalid for the others.

## Proof

- `uv run pytest tests/test_worker.py tests/test_schema.py -q`: structured
  fixture shape, missing-file typed failure, real-audio run asserting the
  source.audio input entry and events, adaptive/schema vocabulary checks.

## Delete test

Revert the missing-file branch to the old empty-model path and
`test_analyze_missing_native_is_typed_failure` fails; delete the adaptive
grid rule and the schema test fails on the empty-grid case.

## Seams

- The TypeScript Zod discriminated union by level is a named follow-up
  (T-ANA-12 evidence); the Python side stands today.

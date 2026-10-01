# T-ANA-15: Readiness computed from inputs

Closes F-ANA-04, F-ANA-23; probes P-70-levels, P-137-readiness.

## What changed

- `readiness.py` (new): the 19 capability keys from the work package,
  `input_entry`, `blank_inputs`, `compute_readiness` (FULL requires the DJ
  grid, source.audio, a native structure input, ml.allinone.structure,
  dsp.features, events.detectors and plan.generated; STRUCTURED requires the
  grid plus native structure; ADAPTIVE is everything else) and
  `describe_inputs` for the spec 137 click-through.
- The worker marks every input as stages run (present/absent/failed with
  reason and version) and never sets the level by hand; a failed ML entry
  demotes the level honestly.
- `packages/analysis-client/src/readiness.ts` mirrors the keys and rules for
  TypeScript consumers under the same package that owns the protocol.

## Proof

- `uv run pytest tests/test_readiness.py -q`: every required input demotes
  FULL when absent, structured with audio-or-ML missing, adaptive fallback,
  failed-ML demotion, click-through key order, TS mirror key-order drift
  check, and an AST check that the worker contains no direct "full" literal.
- `uv run pytest tests/test_worker.py -q` asserts the artifact's input map
  and readiness agree with the coverage value.

## Delete test

Delete one required key from the FULL rule and the demotion loop fails; edit
the TS key order and the mirror drift test fails.

## Seams

- Library/Inspector/Live click-through UI is T-UI-05 and T-UI-02.

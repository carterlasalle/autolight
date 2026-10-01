# T-ANA-11: Fusion with provenance, and the swallowed error

Closes F-ANA-01, F-ANA-17, F-ANA-27; DS-11; probe P-19-provenance.

## What changed

- `fusion.fuse_sections` implements DS-11 `pssi-first`, `ml-first` and
  `fused` (default): union of boundaries, confidence from agreement plus
  source probabilities, evidence tags such as `rekordbox:PSSI:Up`,
  `allin1:boundary`, `energy:boundary`; when PSSI is absent All-In-One labels
  form sections; feature boundaries from peak novelty participate.
- `build_track_model` keeps `evidence[]` on sections and events (the old
  strip and the test asserting absence are gone) and composes the v2 fields
  (inputs, readinessLevel, gridWarnings, beatFeatures, frameFeatures, key).
- The `events` use-before-assign in the worker is gone (single `events` list
  assembled once); ML failures surface as `ml.allinone.structure: failed`
  with the error text and readiness drops.

## Proof

- `uv run pytest tests/test_fusion.py -q`: schema v2, evidence retained, DS-11
  sections, structured coverage.
- `uv run pytest tests/test_readiness.py -q`: a failed ML input demotes FULL
  to STRUCTURED.

## Delete test

Restore the evidence strip and the fusion evidence assertion fails; restore
the bare except and the failed-ML demotion test fails.

## Seams

- Structure-mode statistics on the validation set (DS-11 owner metric) belong
  to T-ANA-16/T-QA-09.

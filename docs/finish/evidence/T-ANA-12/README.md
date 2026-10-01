# T-ANA-12: TrackModel v2 in both languages from one definition

Closes F-ANA-03, F-ANA-11 (enum), F-ANA-17, F-ANA-24, F-RBL-04 (schema part).

## What changed

- Python side (delivered): `schema.SCHEMA_VERSION = 2`; the event enum is the
  full 19-type spec 22 vocabulary; sections and events keep `evidence`;
  `fusion.build_track_model` emits `readinessLevel`, `analysisCoverage2`
  (level plus the inputs map), `gridWarnings`, `beatFeatures`,
  `frameFeatures` and `musicalKey` when present; `semantic_problems` checks
  strictly increasing beat times, ordered section ranges, events inside the
  grid, and readiness-vs-inputs consistency. Adaptive is the empty-grid
  member of the union.
- Test fixture path for the parity round trip was intended at
  `test-fixtures/analysis/trackmodel-v2.fixture.json`; it was NOT written in
  this wave (listed as a gap).

## Named follow-up (Main-blessed, do not lose)

`packages/contracts/src/index.ts` still holds Zod v1: no slice owns it.
Required v2 upgrade, exact field list:

- `schemaVersion: z.literal(2)`
- strict objects (`.strict()`) so unknown fields error instead of stripping
- `musicalEventTypeSchema` expanded to the 19-type enum
- `evidence: z.array(z.string()).optional()` on sections and events
- `gridWarnings` typed array (source, medianOffsetMs, p95OffsetMs, driftMs,
  evidence, beatRange, segments)
- `analysisCoverage2.inputs` map keyed by the 19 readiness keys plus
  `readinessLevel`
- `beatFeatures` (per-beat feature rows) and optional `frameFeatures`
  reference, `nativeAnalysis.rekordbox` (PSSI mood/bank/endBeat/fill/raw,
  cues, waveform flags) and `phrases`
- JSON Schema exported from Zod, Python models generated from it
  (datamodel-code-generator via uv run), drift-checked in CI

QualM6's additive `packages/contracts/src/schema-validation.property.test.ts`
must keep passing when the upgrade lands.

## Proof

- `uv run pytest tests/test_schema.py tests/test_fusion.py -q`: v2 shape,
  19-type enum, semantic checks, adaptive grid rule.
- Old test asserting evidence absence was deleted and replaced by the
  evidence-retained assertion.

## Delete test

Delete one event type from the Python enum and the vocabulary test fails;
delete the readiness cross-check and a mismatched inputs/level fixture passes.

## Seams

- Parity test (a v2 fixture parses in both languages, byte-equal after round
  trip) cannot be green until the Zod upgrade above; it is the T-ANA-12
  blocker.

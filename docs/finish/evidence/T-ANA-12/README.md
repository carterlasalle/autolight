# T-ANA-12: TrackModel v2 in both languages from one definition

Closes F-ANA-03, F-ANA-11 (enum), F-ANA-17, F-ANA-24, F-RBL-04 (schema part).

## What changed

- `packages/contracts/src/index.ts`: `trackModelSchema` is now Zod v2.
  `schemaVersion: z.literal(2)`; `.strict()` on the model and every new
  object so unknown fields error instead of stripping (F-ANA-24);
  `musicalEventTypeSchema` is exactly the 19-type spec 22 vocabulary in
  `EVENT_TYPES_19` order; sections and events carry optional `evidence[]`
  (F-ANA-17); events carry optional `fakeImpactBeat`/`actualImpactBeat`/
  `variant`; new `gridWarningSchema` (source, medianOffsetMs, p95OffsetMs,
  driftMs, evidence, beatRange, segments), open-row `beatFeatureSchema`,
  `frameFeaturesRefSchema`, `musicalKeySchema`, `inputEntrySchema`,
  19-key strict `analysisInputsSchema`, `phraseSchema` (mood/bank/fill/
  fillBeat/raw ints), `nativeRekordboxSchema` (mood/bank/endBeatNative,
  passthrough cues, waveformFlags, per-tag outcomes) and permissive-inside
  `nativeSeratoSchema`; required `readinessLevel` plus `analysisCoverage2`
  (level plus the 19-key inputs map); optional `metadata`, `nativeAnalysis`,
  `frameFeatures`, `musicalKey`, `tempo`; beat grid union plus `superRefine`
  so ADAPTIVE carries an empty grid and every other level needs beats
  (F-ANA-03). Legacy `analysisCoverage` stays required (worker still emits
  it). ShowPlan, DeckState and fixtures are untouched.
- `packages/show-planner/src/events.ts`: canonical v2 aliases now map to
  behaviour instead of the soft-accent default. `bass-re-entry` and
  `drum-re-entry` ride the re-entry impact; `major-section-transition` and
  `minor-phrase-transition` turn the phrase. Legacy spellings
  (`bass-reentry`, `drop_continuation`, `transient`, `section-transition`)
  keep working; unknown types still get a soft accent, never silence.
- Fixtures: the five committed v1 trackmodels
  (`live-deck1`, `live-deck2`, `live-homecoming`, `homecoming`,
  `real-track-1`) were regenerated through `fusion.build_track_model`
  (sections become phrases, inputs marked grid/pssi/fusion present, audio
  absent) so sections, events, grids, duration and identity are
  byte-identical to v1 and only the v2 envelope is new. New parity fixture
  `test-fixtures/analysis/trackmodel-v2.fixture.json` exercises the fullest
  honest shape (evidence, fake/actual impact beats, gridWarnings,
  nativeAnalysis, musicalKey, frameFeatures).
- Tests: `trackmodel-v2.fixture.json` parses in both languages
  (`schema-validation.property.test.ts` plus `analysis/tests/test_schema.py`
  parity cases, byte-equal after sorted-keys round trip); the 16 player-side
  `TrackModel` literals plus `screens.test.ts` moved to v2; the events map
  covers the v2 vocabulary. Python side (prior wave): `SCHEMA_VERSION = 2`,
  19-type enum, evidence retained, readiness computed from inputs.

## Proof

- `yarn vitest run`: 177 files passed, 1087 tests passed, 2 skipped.
- `yarn typecheck`: zero `error TS`.
- `yarn build`: green.
- `uv run --project analysis pytest -q`: 89 passed, 2 skipped.
- `node docs/finish/tools/check-coverage.mjs`: OK (227 tasks, 273 findings,
  36 decision switches, 189 probes, 30 runbooks, 242 config keys).
- `yarn truth`: exit 0 (ratchet warnings only, no errors).
- Parity: `trackmodel-v2.fixture.json` returns `[]` from Python
  `validate_track_model` and `safeParse success` from Zod on the same bytes.
- All five migrated fixtures return `[]` from both validators.

## Delete test

- Delete one event type from either enum and the vocabulary test fails;
  delete the readiness cross-check and a mismatched inputs/level fixture
  passes; delete the `isFresh`-style beat mapping and the OS2L master-deck
  test goes red.
- Remove `.strict()` from `trackModelSchema` and the extra-field property
  assertion goes red. Shrink the event enum and the parity fixture stops
  parsing. Drop a required inputs key and the missing-key assertion goes
  red. Empty the beats of a `full` model and the adaptive-grid refinement
  goes red.
- Remove the `bass-re-entry` alias and the re-entry mapping test goes red;
  remove the transition aliases and the phrase-turn mapping test goes red.

## Seams

- `reference-track.json` stays v1 on purpose: its one-beat grid cannot hold
  beats 32 to 96, so Python semantic validation rejects a naive v2 port.
  The planner golden consumes it unvalidated (`as TrackModel`), which is
  why the suite stays green. A proper v2 golden input needs a full grid;
  that is planner-golden work, not this slice.
- No JSON-Schema export plus `datamodel-code-generator` step exists yet:
  the parity fixture plus the two mirror tests are the drift check. The
  generated-code pipeline is a named follow-up, not a silent skip.
- e2e `m1-slice.journey.ts` (Electron window never paints `#root`) fails on
  the clean tree too (verified via `git stash`); pre-existing, unrelated to
  this change.

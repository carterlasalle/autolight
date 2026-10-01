# T-QA-09 Curated visual validation set

Closes F-ANA-26, F-QA-13; probe P-116-validation-set.

## What changed

- `qa/validation-set.yaml` (new): manifest with the 13 spec 116 categories, `minPerCategory: 3`, empty `tracks` with a commented candidate-row template. Audio never committed.
- `qa/validation-set.md` (new): candidate table plus review-tooling description.
- `analysis/tests/validation/validation_set.py` (new): manifest loader plus shape check, per-category coverage counting, `missing_categories`, and `review_sheet` rendering all eight spec 116 aspects plus spec 115 diagnostics.
- `analysis/tests/validation/test_validation_set.py` (new, 5 tests): manifest shape, empty-manifest misses-everything, confirmed-track coverage, sheet aspect coverage, manifest location seam.

## Proof

- `python3 -m pytest analysis/tests/validation/test_validation_set.py -q`: 5 passed (also green under `uv run --project analysis pytest`).
- Failing-capable: empty tracks fail coverage honestly; a candidate-status track does not count; drop an aspect from ASPECTS and the sheet test fails.

## Delete test

Delete the `status == "confirmed"` filter and unconfirmed candidates inflate coverage. Delete the categories assertion and a manifest with renamed categories passes silently.

## Seams

- Needs owner tracks (OD-10): every entry is a candidate until the owner confirms. The render tool (video plus pre-filled sheet for one validation track on the reference room) needs owner audio first; the test pins that seam.
- `pyyaml` added to `analysis/pyproject.toml` dependencies (was transitive only); lockfile regen pending (see T-ANA-17).

# T-RBL-05: One definition for PSSI labels and section normalization

Closes F-RBL-07. Spec 5.2, 21.

## What was wrong

The PSSI mood tables and the `k1` `k2` `k3` expansion rules were hand-written
twice: `HIGH_LABELS` / `MID_LABELS` / `LOW_LABELS` / `_NORMALIZE` in
`analysis/src/autolight_analysis/native.py` and again in
`packages/rekordbox-library/src/index.ts`. The two copies also disagreed on
section normalization (the TypeScript copy was case-sensitive, the Python copy
lowercased the first word).

## What changed

- One committed table: `analysis/tests/fixtures/pssi-labels.json` (41 KB,
  generated, never hand-edited). It carries the mood maps, the high-mood variant
  rules for Intro, Up, Chorus and Outro, the §21 section vocabulary, and a case
  matrix of 416 `(mood, kind, k1, k2, k3) -> label, section` rows.
- `src/pssi.ts` evaluates that table: `highPhraseLabel`, `phraseLabel` and
  `normalizeSection` are now data-driven; the hand-written maps are gone
  (`unknownTemplate` spells `Unknown<kind>`, and `unknownSection` is
  `unknown`). `AUTOLIGHT_PSSI_LABELS` overrides the file location for packaged
  builds.
- Regeneration (the source of truth today is `native.py`, which the analysis
  package owns):

  ```
  uv run --project analysis python - <<'PY'
  import json, sys
  sys.path.insert(0, "analysis/src")
  from autolight_analysis import native

  cases = [
      {"mood": m, "kind": k, "k1": a, "k2": b, "k3": c,
       "label": native.phrase_label(m, k, a, b, c),
       "section": native.normalize_section(native.phrase_label(m, k, a, b, c))}
      for m in (1, 2, 3, 4) for k in range(0, 13)
      for a in (0, 1) for b in (0, 1) for c in (0, 1)
  ]
  doc = {
      "schema": "autolight/pssi-labels@1",
      "generator": "uv run --project analysis python - <<'PY' (see docs/finish/evidence/T-RBL-05/README.md)",
      "source": "analysis/src/autolight_analysis/native.py HIGH_LABELS/MID_LABELS/LOW_LABELS/_NORMALIZE",
      "moods": {"1": "high", "2": "mid", "3": "low"},
      "high": {str(k): v for k, v in sorted(native.HIGH_LABELS.items())},
      "mid": {str(k): v for k, v in sorted(native.MID_LABELS.items())},
      "low": {str(k): v for k, v in sorted(native.LOW_LABELS.items())},
      "highVariants": {
          "1": {"template": "Intro {n}", "flag": "k1", "nWhenSet": 1, "nWhenClear": 2},
          "2": {"rules": [{"k2": 0, "k3": 0, "label": "Up 1"}, {"k2": 0, "k3": 1, "label": "Up 2"}], "fallback": "Up 3"},
          "5": {"template": "Chorus {n}", "flag": "k1", "nWhenSet": 1, "nWhenClear": 2},
          "6": {"template": "Outro {n}", "flag": "k1", "nWhenSet": 1, "nWhenClear": 2},
      },
      "unknownTemplate": "Unknown{kind}",
      "sections": dict(native._NORMALIZE),
      "unknownSection": "unknown",
      "cases": cases,
  }
  json.dump(doc, open("analysis/tests/fixtures/pssi-labels.json", "w"), indent=2)
  PY
  ```

## Proof

- `src/pssi.test.ts` evaluates all 416 cases through the TypeScript module and
  compares them with the live Python tables and functions (drift check through
  `uv run --project analysis python`): high, mid, low, sections, every label and
  every normalized section.
- Python side of the same matrix: 416 labels, 33 distinct outcomes.
- The TypeScript and Python sides agree on unknown moods and kinds
  (`Unknown4`, `Unknown99`) and on case-insensitive first-word normalization.
- Full package run: 9 files, 54 passed, 1 skipped.

## Delete test

Delete `analysis/tests/fixtures/pssi-labels.json` and `src/pssi.test.ts` fails
at load time (the module reads the table at first use) and
`src/index.test.ts` fails on `phraseLabel(1, 5, 0)`. Change one label in the
JSON (for example `"Up 3"` to `"Up Three"`) and both the table case assertions
and the Python drift check go red, which is the "one edit moves both outputs"
property.

## Hand-offs (outside this slice)

- `analysis/src/autolight_analysis/native.py` still owns the hand-written
  tables; the analysis owner should load the JSON through the config bridge
  (T-CFG-03) and delete `HIGH_LABELS` / `MID_LABELS` / `LOW_LABELS` /
  `_NORMALIZE`, which makes the JSON the single source rather than the mirror.
  Until then the drift check above is what keeps them equal.
- The plan places the file at `packages/contracts/data/pssi-labels.json` with a
  JSON Schema; this slice owns only `analysis/tests/fixtures/pssi-labels.json`.
  Moving it is a two-line change in `src/pssi.ts` (`DEFAULT_LABELS_PATH`) plus
  the Python loader.

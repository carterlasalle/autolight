# T-RBL-04: Full ANLZ extraction with per-tag outcomes

Closes F-RBL-02, F-RBL-03, F-RBL-04, F-RBL-05. Probes P-5-anlz-full,
P-5.2-pssi-retained, P-5.3-cues, P-5.4-waveforms, P-5.5-vocal. Spec 5.1-5.5.

## What was wrong

PWAV and PWV2-7 plus PWVC were reduced to presence booleans; PCO2 lacked cue
type, RGB colour, colour ID and loop quantization; PSSI mood, bank, end beat,
fill, fill beat and raw entries were extracted then dropped by fusion; EXT
and 2EX parse failures were swallowed per file, so one unknown tag (the EXT
variant raising `ConstError`) lost all PSSI with no diagnostics.

## What changed

- `analysis/src/autolight_analysis/native.py`: every tag extracts in its own
  guarded step recording `{tag, file, status: ok | absent | failed, error?}`.
  PQTZ full grid; PSSI mood, bank, end beat, per-phrase start/kind/k1/k2/k3/
  fill/fill beat/label/raw plus raw entry hex; PCO2/PCOB position, loop end,
  cue type, hotcue number, RGB colour, colour ID, comment, loop numerator and
  denominator; PWAV/PWV2-7 arrays retained with shape/encoding metadata;
  PWVC vocal lane decoded with raw retained (encoding documented as
  unresolved where the mapping is unknown, never silently dropped).
  The `ConstError` EXT variant falls back per tag, keeping every other tag.
  Legacy `hasWaveform`/`has3Band`/`hasVocals` booleans stay as derived flags
  so the worker keeps working; the arrays are the truth.
- `analysis/tests/test_native_full.py` (new): every field of every tag on the
  committed `anlz-sample`, the fallback test, the missing-2EX test.

## Proof

- `uv run --project analysis pytest analysis/tests/test_native_full.py
  analysis/tests/test_native.py`: 15 passed (9 new, 6 existing).
- Owner-library counts (opt in, `AUTOLIGHT_OWNER_LIBRARY=1`): not run in
  this slice; the outcomes list is the surface the owner run reports
  per-tag counts from.
- Failing-capable: reduce PWV6 to a boolean and the retained-columns test
  goes red; swallow EXT errors per file and the fallback test loses PQTZ;
  drop `rgb` from cues and the full-cue test names the missing field.

## Delete test

Delete the outcomes list and the per-tag test fails on `outcomes`.
Restore the bare `except` around the whole EXT parse and the fallback test
goes red (PQTZ lost). Delete `_cue_from_entry` colour fields and the cue
test reports the exact missing key.

## Seams

- AnalysisM3 (T-ANA-12): consumes `nativeAnalysis.rekordbox` (grid,
  phrases, cues, waveforms, vocal, outcomes) in TrackModel v2; owns the TS
  contract test parsing the resulting model.
- Worker compatibility: `worker.py` keeps reading the legacy flags;
  waveform/vocal consumers read `waveforms`/`vocal` (new keys).

# T-TRU-16: Portable Python tests

Closes F-ANA-25, scar S19.

## What was wrong

Three pytest tests hardcoded `/Users/rocket/...` paths (Rekordbox ANLZ cache
and Music folder), failing on any other machine, so CI pytest was red.

## What changed

- Committed fixtures already exist from the prior session:
  `analysis/tests/fixtures/anlz-sample/` (244K real ANLZ DAT/EXT/2EX) and
  `synth-beats.wav` (synthetic audio yielding real DSP events). All worker
  and native tests read these relative to the test file, no absolute paths.
- New `analysis/tests/owner/test_owner_library.py`: the two owner-machine
  reads (ANLZ cache scan, demo MP3 decode) moved behind
  `AUTOLIGHT_OWNER_LIBRARY=1` and skip with an explicit reason otherwise.

## Proof

- `uv run --project analysis pytest -q`: 46 passed, 2 skipped (owner tests
  skip visibly on non-owner machines).
- No `/Users/`, `/home/`, or `C:\Users` literals remain in `analysis/tests`
  outside the owner-gated file (grep in CI via ast-grep rule follow-up).

## Delete test

Delete the fixtures dir and `test_extract_real_anlz` plus
`test_analyze_full_with_real_audio` go red. Unset the env var on the owner
Mac and the owner tests skip with the named reason.

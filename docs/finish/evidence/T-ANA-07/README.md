# T-ANA-07: Beat This cross-check

Closes F-ANA-15; part of DS-12.

## What changed

- `metrical.py`: `beat_this_beats` runs Beat This through its Python
  inference API with a process-wide session (weights load once);
  `beat_this_cli` invokes the CLI with the correct `--output`/`-o` flag and
  optional `--gpu`; `ml_beats` selects by `analysis.beatthis.invoke`
  (`api` default, `cli`); beat-in-bar is derived from downbeat positions
  (no longer treating every first column as a downbeat).
- `metrical_vote` implements DS-12 `beat-this`, `allinone-beats`, `both`
  (default): per-source comparison, agreement vote, downbeat confidence.

## Proof

- `uv run pytest tests/test_metrical.py tests/test_grid_stems_harmony.py -q`:
  legacy boolean behavior, typed warnings, agreement vote shape.
- Beat This 1.1.0 is installed in the analysis venv (`beat_this` binary and
  `beat_this.inference` both present); a real-weight click-track accuracy run
  (10 ms beats, correct downbeats) has NOT been executed in this wave.

## Delete test

Drop the `-o` handling and the CLI path writes nothing; remove the
`beatInBar` derivation and the downbeat-agreement assertion fails.

## Seams

- Real-weights accuracy is the T-ANA-16/CI ML job's measurement; weights
  download policy is T-ANA-05.

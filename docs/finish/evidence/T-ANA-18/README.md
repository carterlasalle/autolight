# T-ANA-18: Harmonic tension proxy and key

Closes F-ANA-14, F-ANA-28.

## What changed

- `harmony.py` (new): `cqt_chroma` (sparse constant-Q kernel, documented
  O(frames x bins) with an FFT-mapping upgrade note), `estimate_key` by
  Krumhansl major/minor profile correlation with a confidence value, and
  `harmonic_tension` per frame (tonal distance from the estimated key centre
  plus a dissonance share on semitone and tritone degrees).
- The worker computes chroma on the canonical mono stream, records the key
  on the model as `musicalKey`, aligns tension onto beats, and feeds the
  slope into build detection (`harmony:tension-rising` evidence tag).

## Proof

- `uv run pytest tests/test_grid_stems_harmony.py -q`: on synthetic chord
  material the tension is higher in the dominant (G7) span than in the tonic
  spans, and the key estimate returns a confidence above zero.
- Key accuracy against `qa.key.minAccuracy` on generated tonal material has
  NOT been measured in this wave (gap).

## Delete test

Return a constant tension and the dominant-vs-tonic assertion fails; drop the
tension slope from build detection and the evidence tag disappears.

## Seams

- Continuous key changes and modulation tracking are a planner-side concern
  (spec 28/29), outside this slice.

# T-ANA-09: The 22 DSP features with correct aggregation

Closes F-ANA-09, F-ANA-10; probe P-18-feature-suite.

## What changed

- `features.frame_series` computes all 22 spec 18 features at
  `analysis.frame.size`/`analysis.frame.hop`: integrated loudness proxy
  (K-weighted, documented as a proxy), short-term RMS, bass/low-mid/mid/high
  energy (`analysis.bands` edges), spectral centroid, rolloff, flux, onset
  strength, onset density, zero-crossing rate, kick-like and snare-like
  transients, bass/drum/vocal/other stem RMS (from T-ANA-06 selection),
  silence probability, novelty, dynamic range, energy derivative.
- `features.aggregate_to_beats` aggregates frame series to sub-beat
  (`analysis.aggregate.subdivisions`, default 4), beat and bar windows using
  the real beat timestamps; partial windows divide by their true frame count.
- The dead helpers were wired in (`rms`, `energy_slope`, `spectral_flux`,
  `silence_probability`, `beat_aggregate` all have callers or tests); the
  worker writes the frame series artifact plus `beatFeatures` on the model.

## Proof

- `uv run pytest tests/test_features.py tests/test_config_bridge.py -q`:
  analytic expectations plus the tuning-surface check that detector
  thresholds come from config, not literals.
- The 1.4 s offset regression lives in `resample_to_beats` (time-based
  windows) exercised via the stems tests.

## Delete test

Remove the true-length partial window rule and the constant-signal property
breaks; revert to the old linspace resample and the shift regression returns.

## Seams

- Sub-beat aggregation consumes the selected stem envelopes, so DS-10
  (T-ANA-06) is an input, not a duplicate.

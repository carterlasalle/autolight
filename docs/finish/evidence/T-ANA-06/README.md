# T-ANA-06: Real stems with labelled fallback (DS-10)

Closes F-ANA-06.

## What changed

- `stems.py`: `select_stems(mono, rate, mode, allinone_stems)` implements
  DS-10. `fusion` (default) uses real All-In-One stems when available and FFT
  band proxies otherwise; `allinone-stems` raises when no separation exists;
  `band-proxies` forces proxies. The return carries the label
  `ml.stems` or `dsp.stemProxies`, recorded on the feature artifact as
  `stemSource` and mirrored into the model inputs map.
- Proxies are now bass/drum/vocal/other (plus the legacy band extras);
  feature extraction consumes the selected envelopes.

## Proof

- `uv run pytest tests/test_stems.py -q`: proxy bands, source labels for the
  fusion fallback and the separation path.
- `uv run pytest tests/test_grid_stems_harmony.py -q`: a synthetic bass-sine
  plus kick mix shows the bass proxy correlation against the known source
  above 0.3, recorded in the test.

## Delete test

Force `select_stems` to always return proxies and the label assertions fail;
delete the allinone branch and the fusion source-label test fails.

## Seams

- The DoD's real-vs-proxy separation metric (correlation with known sources
  for real stems) needs the ML weights; the present test uses proxies as the
  documented baseline.
- `analysis.stems.keepAudio` handling for stored stems is Setup-adjacent and
  not implemented here (feature envelopes only).

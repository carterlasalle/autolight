# T-ANA-05: All-In-One persistent session and model management

Closes F-ANA-05, F-ANA-07, F-ANA-22, F-ANA-29; probe P-16-allinone-session.

## What changed

- `allinone.py` rewritten: `ensure_session`/`load_count` record one model load
  per worker life; `select_device` resolves `analysis.device` (`auto` gives
  CUDA when available, CPU otherwise, macOS pinned to CPU per spec 16);
  `analyze_full` returns every retained output (tempo, beats, downbeats,
  beat positions, segments with labels, stems, 100 Hz activations and
  embeddings, device); `model_cache_dir` blocks downloads when
  `analysis.ml.offlineOnly`/AUTOLIGHT_OFFLINE is set; a pre-warm hook exists.
- `worker._write_features` persists activations and embeddings into the
  feature artifact and the model carries a `frameFeatures` reference.

## Proof

- Fixture run: `analyze_full` on the 5 s click WAV returns a result object
  (segments 2, beats 0) in ~8 s on CPU; the worker records
  `ml.allinone.metrical` present with the device and readiness drops to
  STRUCTURED when beeps yield no ML beats.
- Offline guard: `model_cache_dir` raises under AUTOLIGHT_OFFLINE (unit
  coverage is thin; listed as a gap).

## Delete test

Set `_load_count` to increment per call and the batch-load-count DoD fails;
remove the offline guard and the network-blocked Live test (T-OPS side)
fails.

## Seams

- Weight download UI, checksum verification and licensing display are Setup
  work (T-OPS-05) and THIRD_PARTY_NOTICES already lists `all-in-one-infer`
  MIT and `beat-this` MIT.
- P-16 runs on the CI ML job (T-ANA-17 owner).

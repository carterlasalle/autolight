# T-AUD-02: Independent DSP

Closes F-AUD-01; probe `P-68-audio-dsp` (spec 68).

## What changed

- `packages/reactive-audio/src/dsp.ts` (new; re-exported from `index.ts`),
  written from the concepts, no third-party DSP code:
  - Hann window and an in-place iterative radix-2 FFT (`audio.fftSize`).
  - HTK mel scale and a triangular mel filterbank (`audio.melBands`), with
    `melEnergies`.
  - Live band energies (`bass`, `lowMid`, `mid`, `high`) and their mix.
  - `spectralDifference` (signed) and `spectralFlux` (half-wave rectified).
  - `OnsetDetector`: spectral flux against an adaptive (z-score) threshold
    (`audio.onset.threshold`), with a refractory period so one attack inside
    overlapping hops fires once.
  - AGC (`audio.agc.rise`, `audio.agc.decay`, `audio.agc.target`): the
    existing `agcStep` moved here from `index.ts` (one source of truth) and
    `FrameAgc` applies it per frame.
  - `tempoFromOnsets`: autocorrelation tempo estimate for DS-23, with a
    halving pass that prefers the faster of two equally strong periods.
  - `LiveFeatureExtractor`: ring buffer of the newest `audio.fftSize`
    samples, one `LiveFeatures` frame per hop with level, peak, bands, mix,
    mel, flux, onset, tempo and gain.

## Proof

Command (from `packages/reactive-audio`):

```
../../node_modules/.bin/vitest run src/dsp.test.ts
```

Observed: `Tests 11 passed (11)` (part of the package run `Tests 26 passed
(26)`).

- `puts a bin-aligned sine in its bin`: the peak is at bin 5 of 64 with the
  neighbours more than 3x lower, and a wrong-length frame throws.
- `builds one triangular filter per mel band`: 24 filters over `fftSize / 2 +
  1` bins, each with positive weight.
- `puts sine energy in the right live band and mel band`: 100 Hz is over 90
  percent bass, 1 kHz over 90 percent mid, 3 kHz over 90 percent high, and
  the mel peak moves up with the tone.
- `tracks a sine sweep across the bands`: the low bands carry the start and
  the high band over 90 percent of the end.
- `rectifies the spectral difference for flux`: signed sum 1, flux 2,
  identical spectra 0, mismatched lengths throw.
- `detects clicks within one hop`: three clicks are each detected inside one
  hop of their own frame, exactly once per click.
- `fires on a noise burst after silence`.
- `stays quiet on a steady tone once the history is warm`: zero onsets after
  the warmup.
- `converges the AGC gain and clamps at the range edges`: the gain drives a
  0.2 signal to the 0.5 target and clamps at 4 on a much quieter signal.
- `estimates the tempo of a click train`: 120 BPM and 60 BPM trains inside 3
  BPM, confidence over 0.5, null below eight onsets.
- `estimates 120 BPM from a click train through the extractor`.

## Delete test

- Remove the refractory period (constructor value 1 instead of
  `fftSize / hopSize`). Seen red this session: `detects clicks within one
  hop` failed with 6 detections for 3 clicks.
- Set the onset denominator floor to 1e-9 and a numerically steady flux
  reads as an onset (the steady-tone test goes red).
- Remove the halving pass in `tempoFromOnsets` and a 120 BPM click train can
  read as 60 BPM (red).
- Clamp the AGC gain differently and the convergence and clamp assertions go
  red.

## Remaining seams

- The caller passes the resolved `audio.*` configuration; the module's
  constants are the defaults that mirror the registry.
- `LiveFeatureExtractor` output feeds the overlay (T-AUD-03) and the
  `AudioTempo` handoff into the runtime's adaptive clock (T-RUN-06).

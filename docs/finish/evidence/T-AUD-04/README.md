# T-AUD-04: Audio timing alignment

Supports F-LIVE-06 (composite correction) and DS-23.

## What changed

- `packages/reactive-audio/src/timing.ts` (new; re-exported from `index.ts`):
  - `measureLatency`: emits-to-detection latency in milliseconds with a
    confidence that drops when the detected onset is smeared.
  - `alignedShowTimeNs`: a feature detected at capture time `t` describes the
    music at `t - latency` in show clock time (the offset is subtracted, not
    added).
  - `alignFeature`: attaches `showTimeNs` to a captured feature.
  - `LatencyCalibration`: holds the recorded offset; with no measurement it
    returns the capture time unchanged and reports `measured: false`, so an
    uncalibrated path is never presented as aligned.

## Procedure (runbook)

1. Route the DJ output to a loopback input and select it with
   `audio.capture.deviceId` (T-AUD-01).
2. Play a test click through the chosen output (or a reference track with a
   known onset), captured by the same path the show uses.
3. Read the capture timestamp of the detected onset and the emission
   timestamp of the click; `measureLatency({ emittedAtMs, detectedAtMs })`
   gives the offset and its confidence.
4. Record the measurement (qualification) and apply it through
   `LatencyCalibration` before features reach the composite provider
   (T-LIVE-07 correlation) and the adaptive clock (T-RUN-06).

## Proof

Command (from `packages/reactive-audio`):

```
../../node_modules/.bin/vitest run src/timing.test.ts
```

Observed: `Tests 4 passed (4)` (part of the package run `Tests 26 passed
(26)`).

- `measures the capture path latency from an emitted click`: 0 to 120 ms
  gives exactly 120 ms with confidence 1, a 25 ms spread lowers confidence to
  0.75, and the reference-onset method is recorded.
- `aligns a synthetic delayed feature back to show time`: a music event at
  1000 ms captured at 1120 ms aligns to exactly 1000 ms.
- `never presents an uncalibrated path as aligned`: before a measurement the
  capture time passes through unchanged with `measured: false`; after
  recording 120 ms the same capture time aligns to 880 ms.
- `aligns a DSP onset to the music inside one hop`: a synthesized click
  delayed by the measured 120 ms is detected by the real
  `LiveFeatureExtractor` and lands inside one hop (10.7 ms at the test
  settings) of its true show time.

## Delete test

- Drop the subtraction in `alignedShowTimeNs` (add the latency instead) and
  every alignment assertion goes red.
- Return `measured: true` from the uncalibrated `LatencyCalibration.align`
  and the uncalibrated test goes red.
- Break the DSP onset detection and the one-hop test goes red.

## Remaining seams

- The physical measurement (step 2) needs the audio window and a loopback
  device on the owner's machine; the qualification record stores the value.
- The composite provider's correlation (T-LIVE-07) consumes the aligned
  features; the runtime consumes the tempo through
  `ShowRuntime.setAudioTempo` (T-RUN-06).

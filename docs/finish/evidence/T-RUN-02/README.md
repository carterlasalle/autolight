# T-RUN-02: State estimator with smooth correction

Closes F-RUN-01, F-APP-09; probe `P-57-estimator` (spec 57).

## What changed

- `packages/dj-core/src/index.ts`: `BeatEstimator` implements
  `estimated = P + (now - T) * R`, cold-starts by adopting the first
  observation as random access, and corrects small errors with a slew-limited
  phase correction using `runtime.estimator.correctionGain` and
  `runtime.estimator.maxSlewBeatsPerSec`. The correction is a phase term on
  top of the advance the estimator already made, and it can never exceed that
  advance, so the beat never steps backwards while playing forward. Reverse
  playback keeps its signed rate, so the cursor follows the source backward.
- Observation quality weights the correction: `QUALITY_WEIGHT` gives an
  `exact` rkbx-osc time twice the correction of an `estimated` AX time.
- Errors beyond `runtime.seek.thresholdBeats` or `runtime.seek.thresholdMs`
  (converted through the deck tempo, `exceedsSeekThreshold`) become transport
  events instead of corrections; the show runtime turns those into the seek of
  T-RUN-03 in the same tick.
- The renderer cursor math is deleted from the runtime path; the old
  `predicted = prevBeat + 0` and the beats-as-seconds `isSeek` call are gone.

## Proof

- `packages/show-runtime/src/estimator.test.ts` (`P-57-estimator`): noisy
  30 Hz observations with jitter and loss stay under
  `runtime.estimator.maxErrorMs` with zero backward steps; pitch changes of
  plus or minus 8 and 16 percent are tracked inside the bound; the same phase
  step is corrected exactly twice as far with an exact time; a hot cue jump
  becomes a seek, not a slew.
- Scoped smoke run this session: the same property passes over 300 frames with
  one in seven observations lost (max error about 13 ms, zero seeks, zero
  backward steps).

## Left to the owning task

The show host still passes its historical 8-beat seek threshold constant
(`SEEK_THRESHOLD_BEATS` in the host package, the old value the catalog records
for `runtime.seek.thresholdBeats`). Reading the registry value there is the
T-CFG-04 migration; this package already defaults to the catalog value and
accepts explicit thresholds through its own options.

## Delete test

Set `correctionGain` to 0 and every "tracked within the bound" assertion goes
red. Remove the `correction >= -rate * interval` clamp and the zero-backward-
steps assertion goes red. Drop `QUALITY_WEIGHT` and the two-to-one correction
ratio test goes red. Compare beats against milliseconds again (the old
`isSeek(beats, beats)`) and the hot cue test stops reporting a seek.

# T-RUN-06: Source loss, device faults and the adaptive clock

Closes F-RUN-05, F-RUN-10; probe `P-105-source-loss` (spec 105, 107, DS-23).

## What changed

- `packages/show-runtime/src/index.ts`:
  - Clock health from state age is now measured in milliseconds as the
    thresholds say: the nanosecond delta is divided by 1e6 (`NS_PER_MS`).
    Before this the divisor was 1000, so a 300 ms gap read as 300000 ms and
    the extrapolate, hold and degrade windows were unreachable in practice.
    BugCase `BC-000001`, rung 0: the regression test below is the detector.
  - `motionFactor`: full motion while live or extrapolating, faded toward
    `HOLD_MOTION_FLOOR` while the estimate is held, restrained on the
    adaptive clock.
  - Adaptive clock (DS-23): `adaptiveBeat` extrapolates a phase anchor at a
    tempo, with `dj-bpm` (last known provider tempo and phase), `audio-onset`
    (live tempo from T-AUD-02) and `blend` (default; confidence-weighted
    tempo, provider phase).
  - `tickWorld` now stages the loss: a fresh observation feeds the estimator;
    an observation older than `runtime.seek.thresholdMs` only extrapolates
    (a stale observation cannot be told apart from a transport jump, so it
    must not produce a phantom seek); past `runtime.health.extrapolateMs` the
    estimate is held; past `runtime.health.holdMs` the adaptive clock takes
    over. Every branch still evaluates the plan at a beat, so loss alone
    never blanks the show.
  - `DeckTick` gains `clockSource` (`provider`, `hold`, `adaptive`) and
    `motion`; `DeckWorld` retains `lastKnown` (last fresh tempo and phase),
    `holdBeat`, `adaptiveMode` and `audioTempo`; `setAudioTempo` and
    `ShowRuntime.setAudioTempo` are the T-AUD-02 handoff.
  - Device faults (spec 107): `DeviceRuntimeState` carries the effective
    capability and FPS the govee-manager reports, and
    `deviceFrameDue` / `dueDevicesOnTick` keep the logical 60 Hz
    (`LOGICAL_TICK_HZ`) for every healthy device; a faulted device drops out
    without changing another device's rate.

## Proof

Command (from `packages/show-runtime`):

```
../../node_modules/.bin/vitest run src/source-loss.test.ts
```

Observed: `Tests 9 passed (9)`.

- `keeps the plan alive across 300 ms, 1.5 s and 10 s of source loss`: at
  300 ms the clock is still `extrapolating` and the beat advances past 64.4;
  at 1.5 s it is `holding` with the beat frozen across further ticks and
  motion below 1; at 10 s it is `degraded` on `clockSource "adaptive"` with
  beat 84 for a beat-64 anchor at 120 BPM; the section look is evaluated at
  all three windows; a fresh observation returns the clock to `provider`.
- `measures the adaptive clock's beat error after a 10 s loss`: the measured
  error is under 20 ms.
- `blends the live audio tempo...`: with a 128 BPM audio estimate and a stale
  120 BPM provider, the blended clock advances at 124 BPM from the provider
  phase.
- `follows the live audio phase in audio-onset mode`: the estimate tracks the
  audio anchor at 128 BPM.
- `adaptive clock: dj-bpm phase, audio-onset tempo, confidence-weighted
  blend`: unit coverage of the three modes, the zero-confidence fallback and
  the null case.
- `blending a confident live tempo beats dj-bpm alone when the deck pitched`:
  0.67 beats of error against 1.33 beats for the provider tempo alone.
- Device faults: over 60 logical ticks a 60 fps device is due 60 times, a
  20 fps device 20 times, an offline device never; a fault on one device
  leaves another device's 60 ticks unchanged.

Package run (same command without a file): `Test Files 5 passed (5)`,
`Tests 37 passed (37)`, and `tsc --noEmit` is clean.

## Delete test

- Delete the adaptive branch in `tickWorld` (replace the `adaptiveBeat` call
  with a null assignment). Seen red this session: 4 of 9 tests failed (the
  three loss windows, the blend and the audio-onset cases).
- Return the age divisor to 1000 and the 300 ms assertion goes red (the
  window is the assertion itself).
- Drop `audioWeight` from `adaptiveBeat` and both blend tests go red.
- Delete `deviceFrameDue` and the fault counts go red.

## Remaining seams

- The show host today consumes the shared helpers (`clockHealth`,
  `trackDeck`, `quantizeResume`) and keeps its own cursor pipeline; adopting
  `ShowRuntime.tick` is the wiring step that consumes `clockSource`, `motion`
  and `setAudioTempo`. The snapshot path already carries `clockHealth` for
  the status bar.
- The govee-manager (T-GOV-06, T-GOV-08) produces `DeviceRuntimeState`; the
  runtime side here is the rate decision only.

# T-RUN-07: Manual overrides and emergency path

Closes F-RUN-04, F-RUN-07, F-APP-04 (runtime part), F-APP-19, F-GOV-16; probes
`P-134-override`, `P-94-blackout-latency`, `P-50-no-beat-brightness`
(spec 134, 118, 48).

## What changed

- `OverrideState` and the state machine in `packages/show-runtime/src/index.ts`:
  BLACKOUT, WHITE (RGB white at `runtime.override.whiteIntensity`, never
  kelvin), FREEZE (hold the last rendered look and keep the clock running),
  master intensity, force low and force high energy. Emergency kinds engage in
  the call that receives them, with no queue and no rounding.
- Resuming automation quantizes to `runtime.override.resumeDefault` (bar) or
  the requested mode: `next beat`, `next bar`, `next phrase`, `immediate`
  (really immediate). Bar boundaries come from the native grid downbeats and
  phrase boundaries from fused or PSSI phrase starts through `ResumeGrid` and
  `resumeGridFromModel`, never from multiples of four and sixteen.
- `overrideEffect` is the renderer-facing form: a factor, a white intensity, a
  hold flag and a forced energy tier. The renderer applies the manual layer and
  the master layer every frame (T-REND-01).

## Proof

- `packages/show-runtime/src/runtime.test.ts`: every control, every resume
  mode, the pending resume landing exactly on the boundary, and the master
  scaling of the white intensity.
- `packages/show-runtime/src/index.test.ts`: the same state machine at the
  helper level plus the native resume grid.
- `P-94` keypress to UDP p99 and `P-50` brightness commands per minute are
  measured end to end by the recording-transport harness (T-ARC-06, T-QA-02)
  and by the Govee brightness slow path (T-GOV-13); this package supplies the
  same-tick override the host renders.

## Delete test

Make emergency kinds set `pendingResume` and the same-tick assertions go red.
Round `immediate` up again and its test goes red. Ignore the `ResumeGrid` and
the phrase test falls back to a multiple of sixteen.

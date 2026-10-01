# T-REND-03: Colour pipeline and per-fixture calibration

Closes F-REND-03, F-REND-06, F-REND-11, F-PLAN-01 (renderer half),
F-VEN-05 (renderer half). Probes P-29-no-timer-colour, P-49-linear-light.
Spec 28, 29, 49, 76. DS-09.

## What was wrong

Hue came from the start beats of the lowest-priority active cues in HSV and
drifted as chase cues advanced; calibration gamma, brightness ceiling,
orientation and transforms were ignored (fixed 2.2); intensity scaled a pure
hue through a hardcoded 0.75 to 1.0 left-to-right shape instead of scaling
arbitrary colours in linear light.

## What changed

- `packages/renderer/src/color.ts` (new): the shared colour module.
  OKLCH to OKLab to linear RGB (Ottosson matrices, shared with the mixer);
  intensity in linear light (hue-preserving); per fixture white balance
  matrix, brightness ceiling, per-device gamma (exact sRGB transfer by
  default, `render.gammaDefault` only for measured-gamma overrides),
  orientation order flip; sRGB bytes at the transport boundary only.
  `index.ts` and `layers.ts` untouched (RoomM4 confirmed the seam: wiring
  the pipeline into `renderFrame` and deleting the hue-from-start-beat code
  is the orchestrator step, this module is the target it wires to).

## Proof

- `yarn workspace @autolight/renderer test src/color.test.ts`: 4 passed.
  P-49: (255, 0, 90) at 0.30 equals the linear-light expected bytes and
  differs from naive integer scaling; calibration test covers matrix,
  ceiling, measured gamma and reversed orientation; hue preserved under
  intensity scaling.
- Failing-capable: scale sRGB integers and the P-49 test goes red;
  drop the ceiling clamp and the capped-vs-scaled equality fails; use the
  2.2 approximation as default and the exact-transfer expectation fails.

## Delete test

Delete `src/color.ts` and the block fails to import. Reintroduce
`(startBeat * 137 + 210) % 360` hue and the P-29 alignment test (planner
side) names the regression; reintroduce the 0.75 to 1.0 shape and the
linear-light test goes red.

## Seams

- RoomM4 wires `color.ts` into `renderFrame` (owns `index.ts` export lines)
  and deletes `lookHue`/`shape`; PlannerM3 consumes OKLCH palette
  references (owns plan colours); the mixer already shares the matrices.
- P-29 (colour changes only on section/phrase/motif boundaries) is proven
  at the planner; this module guarantees the renderer cannot reintroduce
  timer hues once wired.

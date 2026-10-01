# T-MIX-02: Base mixing in perceptual and linear space

Closes F-MIX-02, F-MIX-05, F-PLAN-13; probe `P-64-violet` (spec 64, DS-09).

## What changed

- Base weights are never normalized to one: `baseWeights` returns the raw
  audible weights, so a lone quiet deck produces a proportionally quiet look
  and two decks at half weight are as bright as one at full weight.
- `packages/show-mixer/src/blend.ts` is the mixer's side of the shared colour
  module: sRGB and linear light, Ottosson OKLab, OKLCH, and `blendColors` for
  the four `mixer.blendSpace` spaces (`oklab`, `linear-rgb`, `srgb-legacy` for
  comparison, and the combined `oklab-hue-linear-intensity`). Intensity is the
  unnormalized weight total applied in linear light.
- `mixDown` carries the chosen blend space to the renderer in `blendSpace`, so
  the mixer and the renderer cannot disagree about DS-09.
- T-REND-03 consolidates this module into `packages/renderer/src/color`; the
  renderer keeps its own gamma convention until that task lands, and the
  committed renderer golden is unchanged by this task.

## Proof

- `packages/show-mixer/src/blend.test.ts` (`P-64-violet`): the cyan to magenta
  midpoint has an OKLCH hue inside the violet band (about 301 degrees), the
  four spaces differ from each other, a lone deck at weight 0.3 lands at the
  expected linear-light intensity (byte 149 for white), and sRGB and linear
  light round trip within one byte.
- Scoped smoke run this session: the same checks pass (hues 301, 284, 280 and
  301 for the four spaces).

## Note for the UI and the host

The show host snapshot now carries these unnormalized weights (a value of 1
means fully audible, two decks at 1 are both fully audible). A UI that wants a
share must divide by the total itself; the mixer no longer does that for it.

## Delete test

Divide by the weight total again and the lone-deck intensity assertion goes
red. Blend in sRGB only and the violet hue test goes red. Drop the round-trip
property and a change in either transfer function stops being caught.

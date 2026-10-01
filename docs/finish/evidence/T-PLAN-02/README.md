# T-PLAN-02: Whole-song identity and colour story

Closes F-PLAN-01, F-PLAN-13; probe `P-28, P-29`.

## What changed

- `src/color.ts`: OKLCH/OKLab module (published transform matrices), `blendOklch` in OKLab, `generateCorePalette` (seeded 2 to 3 hues, chroma from style saturation, lightness from track energy), `ensureMinDistance` (bounded hue-shift repair), `neutralWhite` accent. `blendRgb` kept only for the pre-existing unit test.
- `src/identity.ts`: `planIdentity` chooses `globalDesign` (primary/secondary palettes, neutral accent, spatial motif origin/direction/heads, movement vocabulary, density/contrast baselines, impact/darkness budgets) before any cue; `colourChangeAllowed` gates changes to section/phrase/motif-return beats.
- Compile paints section looks from the identity palette; validator counts colour identity on section looks only (ramps desaturate and foreshadowing glimpses by design).

## Proof

- `src/identity.test.ts`: all `globalDesign` fields populated, 2 to 3 core colours with pairwise OKLCH distance at the configured floor, section look uses the identity hue (not an invented one), 100 percent of colour-identity changes land on section or motif-return boundaries.
- Red run observed this session: counting ramp/foreshadowing colours as palette changes gave `0.5` justified instead of `1`; scoping the count to section looks fixed it.

## Delete test

Drop `ensureMinDistance` and the pairwise-distance case goes red. Paint looks from `(startBeat*137)%360` and the identity-hue case goes red (the old renderer behaviour, now impossible: the renderer reads plan colours).

## Seams

Mixer blend-space direction (DS-09): planner mixes in OKLab, never sRGB. Renderer consumes `color`/`paletteRef` per cue (T-REND-03).

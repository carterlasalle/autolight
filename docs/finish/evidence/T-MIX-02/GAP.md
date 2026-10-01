# T-MIX-02: Base mixing in perceptual and linear space (gap close)

Closes F-MIX-02, F-MIX-05, F-PLAN-13; probe `P-64-violet` (spec 64, DS-09).
Wave 1 built this task; this note records only the gap review, no rewrite.

## Gap review

- Re-read `packages/show-mixer/src/blend.ts` against the DoD: four DS-09
  spaces, unnormalized weights, intensity as the weight total in linear
  light, sRGB/linear round trip within one byte, channels clamped to [0, 255].
  All present; `blend.test.ts` covers violet midpoint, space differences,
  lone-deck intensity, round trip, and clamping.
- No gaps found. The shared-module consolidation into
  `packages/renderer/src/color` is explicitly deferred to T-REND-03 by the
  wave-1 evidence; not started here (that package is mid-flight with the room
  slice).

## Proof

- Same scoped run: `yarn workspace @autolight/show-mixer test` gives 8 files,
  47 tests passed. No source edited by this slice.

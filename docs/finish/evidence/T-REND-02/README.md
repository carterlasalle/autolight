# T-REND-02: Primitive renderers with envelopes

Closes F-REND-02 (and the renderer half of F-PLAN-03).

## What changed

- `packages/renderer/src/spatial.ts` (new): one pure sampler per registered primitive over cell fields plus local beat, `envelopeLevel` in beats, `envelopeFromMs` converting ms through tempo every call (90 ms stays 90 ms under pitch change), `SPATIAL_ENVELOPES` attack/release table, exhaustive switch with `UnknownSpatialError`.
- `packages/renderer/src/primitive-params.ts` (new): renderer-local read shapes mirroring the registry so `spatial.ts` has zero new package dependencies (no show-planner import in production code).

## Proof

- `packages/renderer/src/spatial.test.ts`: orbit motion/wrap, beat envelopes plus 90 ms conversion at two tempi, split alternation, ripple peak, unknown-type error. Renderer suite green.

## Delete test

Hardcode 90 ms to beats at 120 BPM and the 60 BPM assertion goes red. Return mid-level for unknown names and the error test goes red.

## Seams

Color pipeline (T-REND-03, IdentityFastPath `color.ts`) is untouched; this slice never wires color into `index.ts`.

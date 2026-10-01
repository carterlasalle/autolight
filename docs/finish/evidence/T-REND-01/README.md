# T-REND-01: Eight-layer stack with real compositing

Closes F-REND-01, F-REND-08; probes `P-2.5-partial-darkness`,
`P-33-layer-stack` (spec 33, 47, 48, 49).

## What changed

- New `packages/renderer/src/layers.ts`: the eight spec 33 layers in order
  (base look, spatial motion, beat modulation, musical accents, exclusive
  impact effects, live reactive overlay, manual override, master intensity),
  the blend modes (`replace`, `over`, `multiply` for dips and darkness, `add`
  with `ADD_CEILING`, `max` where a primitive asks for it), per-cell
  contributions of colour, alpha and blend, and `compositeLayers`, which
  always applies the stack in spec 33 order whatever order the caller passes.
- Darkness is first-class: a blackout contributes black with blend `replace`
  at its alpha, so a LEFT blackout darkens exactly the LEFT cells over an ALL
  look instead of losing a `Math.max` comparison.
- The compositing section of `packages/renderer/src/index.ts` now builds one
  contribution per active cue, adds the manual override layer
  (`RenderOverrides.manual`, a colour and an intensity, used by T-RUN-07 for
  blackout, white and the forced looks) and scales the master intensity last
  in linear light. `renderFrame`'s new parameter is optional, and the
  committed golden frame (224, 224, 224 and hash a0357d48) is unchanged.
- The hue-from-start-beat heuristic and the hardcoded 0.75 to 1.0 shape
  survive this task only because T-REND-03 owns deleting them with the new
  palette references; the shape is now expressed as a layer alpha.

## Proof

- `packages/renderer/src/layers.test.ts` (`P-2.5-partial-darkness`): a LEFT
  blackout over an ALL look zeroes exactly the LEFT fixture, the mirrored
  RIGHT case behaves the same way, and a dip deepens every channel without
  blacking out a cell.
- Same file (`P-33-layer-stack`): manual beats exclusive beats accents, the
  stack is order-insensitive, master scales the composite last, every blend
  mode has an exact byte expectation, and `add` respects its ceiling.
- Scoped smoke run this session: the P-2.5, P-33 and golden checks pass, and
  the untouched `packages/renderer/src/index.test.ts` expectations
  (blackout at 256, 224 at 257, the golden hash, group targeting, build and
  breakdown levels, latency compensation) were reproduced against the source.

## Delete test

Return to `Math.max` per cell and `P-2.5` goes red (the partial blackout
disappears). Drop the manual layer and the manual-versus-exclusive assertion
in `P-33` goes red. Remove `scaleLinear` from the master stage and the
halved-composite assertion goes red.

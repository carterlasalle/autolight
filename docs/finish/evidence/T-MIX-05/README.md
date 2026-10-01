# T-MIX-05: Incoming deck introduction by layer

Closes F-MIX-06; probe `P-67-introduction` (spec 67, spec 33).

## What changed

- Cues carry a spec 33 layer: an explicit tag from the planner (T-PLAN-13)
  wins, otherwise the primitive maps to its layer in
  `packages/renderer/src/layers.ts` (`layerForCue`). The mixer re-exports the
  same definition as `cueLayer`, so there is one mapping, not two.
- `introductionStage` reads `mixer.intro.paletteAt`, `rhythmAt` and
  `impactsAt`, and `admits` decides per layer: palette admits the base look and
  the secondary spatial layer, rhythm adds the rhythm layers and accents, and
  impacts admits the exclusive layer. The old `priority <= 11` heuristic is
  gone.
- Every cue that does not enter is recorded in `MixResult.dropped` with its
  reason, and `MixResult.layers` groups the survivors by layer and side in
  spec 33 order for the renderer.

## Proof

- `packages/show-mixer/src/intro.test.ts` (`P-67-introduction`): frame samples
  across a fader ramp (0.02, 0.1, 0.5, 0.9) admit nothing, then base and
  spatial, then accents, then the exclusive layer, with four distinct frame
  hashes and the incoming contribution scaled by its unnormalized weight.
- Scoped smoke run this session: the same ramp passes against the source.

## Delete test

Return to the priority bound and the ramp assertions go out of order. Admit
the exclusive layer in the palette stage and the 0.1 sample gains a white hit.
Remove the layer grouping and the renderer loses the layer identity the stack
needs.

# T-PLAN-13: Layer tags and mixing metadata

Closes F-MIX-06 dependency; probe `mixer introduction/ownership`.

## What changed

- Every cue carries its spec 33 layer at compile time (`src/layers-fallback.ts` is the shared spelling; the renderer `layerForCue` is the fallback for legacy untagged cues, never a priority heuristic). Sections carry mix hints: intro/outro blend regions, incoming palette summary, structurally significant exclusive-impact beats.

## Proof

- `src/layertags.test.ts`: every cue tag is a valid spec 33 layer and equals the shared mapping; base and exclusive layers present; every section has intro/outro regions, a non-empty incoming palette, and the drop beat appears in exclusive-impact beats.

## Delete test

Strip the tag and the per-cue case goes red. Drop the impact beats and the hints case goes red. Reintroduce a priority heuristic in the mixer and the intro test (owned by T-MIX-05) goes red.

## Seams

Mixer `introductionStage`/`admits` and `impactOwner` consume these tags instead of heuristics (T-MIX-05, T-MIX-03). Renderer composites in spec 33 order (T-REND-01).

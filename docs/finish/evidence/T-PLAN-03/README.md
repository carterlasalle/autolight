# T-PLAN-03: Six-level hierarchy with future-aware progression

Closes F-PLAN-04; probe `P-2.1, P-2.4, P-30`.

## What changed

- `src/hierarchy.ts`: `LEVEL_ATTRIBUTES` per spec 30 plus `CUE_LEVEL_ATTRIBUTES` (every emitted cue type mapped to its level); `trackArcPosition` (rise/hold/release); `findDropPlans` (drop plus enclosing build); `stagedBuild` (N stages, rising intensity, chase-to-outside-in movement); `phraseCues`/`barCues`/`beatCues`/`subBeatCues` per level.
- Compile plans drops backwards: staged ramps from `buildStart`, desaturation, pre-drop darkness ending exactly at the impact, foreshadowing glimpse, second-drop target variation.
- Track level is encoded as `globalDesign` plus arc-modulated intensities (spec 30 gives the track level identity/progression, not a cue); all five cue levels are emitted and tagged.

## Proof

- `src/hierarchy.test.ts`: staged cues 225-256 with non-decreasing density and blackout ending exactly at 257; all five cue levels present on a validation track; a `pulse` tagged `section` is rejected with `level violation`.
- Red run observed: double-programmed drops (build section plus impact section) duplicated white hits; ownership by the impact section fixed it.

## Delete test

Remove the pre-drop blackout and the exact-257 case goes red. Tag a beat pulse as `section` and the validator case goes red. Shorten the build so no staging fits and the staged-count case goes red.

## Seams

Validator enforces the level table (T-PLAN-10). Drop body lives in `contrast.ts` (T-PLAN-06).

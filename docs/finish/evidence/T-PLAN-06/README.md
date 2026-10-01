# T-PLAN-06: Contrast engine and drop programming

Closes F-PLAN-08; probe `P-35, P-36`.

## What changed

- `src/contrast.ts`: `breakdownCues` (low narrow look plus texture hold); `dropProgram` (staged ramps desaturating toward white, pre-drop darkness of `dropPreDarknessBeats`, white impact of `impactDefaultMs` converted beats-via-tempo, quantized burst of `burstBeats`, saturated body with occurrence-varied target); `fakeDropHold` (black from fake to actual beat, nothing fires at the fake).
- Breakdown vs build contrast from section energies; drop strength scales ramps and saturation.

## Proof

- `src/contrast.test.ts`: breakdown mean under the bound with positive build slope; spec 36 structure present (staged ramps, darkness ending exactly at impact, sub-beat white impact, burst plus body, second drop varies target); fake impact fires no exclusive while the hold is darkness, real beat fires.
- Red run observed: the first fake-drop assertion counted a coincidental `dip` shade as a firing cue; the test now asserts no exclusive impact at the fake beat.

## Delete test

Delete the pre-darkness cue and the exact-impact case goes red. Fire the white hit at the fake beat and the fake-drop case goes red. Flatten ramp intensities and the positive-slope case goes red.

## Seams

Impact ms-to-beats uses `envelopeToBeats` with the deck tempo at compile time; renderer converts at render time. Restraint governs the hit (T-PLAN-05).

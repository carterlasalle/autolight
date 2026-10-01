# T-MIX-04: Transition-aware blackout translation (gap close)

Closes F-MIX-03, F-QA-09; probe `P-66-translate-all` (spec 66, DS-18). Wave 1
built this task; this note records only the gap review, no rewrite.

## Gap review

- Re-read `blackoutDecision`/`translateBlackout`/`deckSideTarget`/
  `structuralState` against the DoD: planner-produced ALL input, all four
  DS-18 modes, auto ladder plus structural case, threshold case, reasons
  recorded, no SIDE target. Covered by
  `packages/show-mixer/src/blackout.test.ts`.
- No gaps found. No source edited by this slice.

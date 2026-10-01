# T-MIX-03: Exclusive impact ownership (gap close)

Closes F-MIX-07; probes `P-65-owner`, `P-65-no-leak` (spec 65). Wave 1 built
this task; this note records only the gap review, no rewrite.

## Gap review

- Re-read `ownerScore`/`impactOwner` against the DoD: all five spec 65
  factors, hysteresis, silent deck scores zero, non-owner exclusives dropped
  with reasons. Covered by `packages/show-mixer/src/owner.test.ts`, including
  the P-65-no-leak frame test.
- No gaps found. No source edited by this slice.

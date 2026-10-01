# T-MIX-06: One path to pixels (gap close)

Closes F-MIX-04, F-MIX-05, F-APP-07, F-UI-05 (data); probes `P-62-two-worlds`,
`P-65-no-leak` (spec 62, 65). Wave 1 built this task; this note records only
the gap review, no rewrite.

## Gap review

- Re-read `mixDown` against the DoD: only `mixDown` plus `renderFrame` reach
  pixels, per-deck upcoming cues with real fields, drop reasons recorded,
  dependency-cruiser rule `renderer-no-show-internals` forbids the UI from
  importing the mixer. Covered by `owner.test.ts` (no leak) and
  `show-runtime` upcoming-cue tests.
- No gaps found. The `apps/desktop` live view-model still blends per-deck
  frames with its own weight math instead of rendering `mixDown` output
  directly, but the live cursor module is outside this slice's target paths; that cleanup
  belongs to the UI slice (T-UI-02), not to the mixer.
- No source edited by this slice.

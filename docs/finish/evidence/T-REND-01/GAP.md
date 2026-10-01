# T-REND-01: Eight-layer stack with real compositing (gap close)

Closes F-REND-01, F-REND-08; probes `P-2.5-partial-darkness`,
`P-33-layer-stack` (spec 33). Wave 1 built this task; this note records only
the gap review, no rewrite.

## Gap review

- Re-read `packages/renderer/src/layers.ts` plus the compositing section of
  `packages/renderer/src/index.ts` against the DoD: eight spec 33 layers in
  order, per-cell colour plus alpha plus blend, darkness as black at alpha
  (`replace`), dip as linear-light `multiply`, manual layer, master scaled
  last, order-insensitive compositing. All present; `layers.test.ts` covers
  P-2.5, P-33, and every blend mode with exact byte expectations.
- No gaps found in the layer stack itself. The room slice has in-flight work
  in this package (`spatial.ts`, `regions.ts`, `capability.ts`,
  `goldens.ts` plus tests); two `regions.test.ts` assertions currently fail
  on dense-frame addressing and the cross-device chase, and `goldens` plus
  `spatial` suites fail to load in this tree. That is the room slice's
  T-REND-05/T-ROOM work, not this stack, and it is left for its owner. No
  source edited by this slice.

## Proof

- `yarn workspace @autolight/renderer test` was run for triage only: the two
  pre-existing `layers`/`index` suites pass; the three failures belong to the
  room slice's new files (see above). No renderer source edited by this
  slice.

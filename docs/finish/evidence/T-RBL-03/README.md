# T-RBL-03: Beat origin, units and beat to time mapping

Closes F-RBL-06, F-RBL-09. Probes P-2.2-grid-truth, P-73-beat-domain,
P-74-mapping. Spec 2.2, 73, 74.

## What was wrong

Two conventions were mixed: the planner spoke 0-based grid indices while
phrases and cues spoke beats. `toNativeBeat` took a field already named
`sourceTimeMs` and multiplied it by 1000 again (F-RBL-09), and the inverse
mapping used a linear `find` with an edge policy that differed from the forward
direction (§74).

## What changed

- `src/beat.ts` is the single place for the beat domain. Branded types `Beat`,
  `BeatIndex0`, `Seconds`, `Milliseconds`, `Ns`; `beatOfIndex` / `indexOfBeat`
  convert the two directions; `MS_PER_SECOND` and `NS_PER_MS` name the units.
- One documented convention (ADR-009): musical position is `Beat`, fractional
  and 1-based, so beat 1 is the first native grid beat and equals grid anchor
  `index 0`; the grid keeps the 0-based `index`. PSSI phrase beats, cue beats,
  ML boundaries and planner cues all use `Beat`.
- `toNativeBeat` takes `sourceTimeSeconds` (PQTZ output) and produces
  `sourceTimeMs` once; it validates index, bar position and time instead of
  silently scaling.
- `beatToSourceSeconds` and `sourceSecondsToBeat` both binary search and
  interpolate piecewise linearly, and they share one edge policy: inside the
  grid linear between anchors, before the first and after the last anchor
  extrapolate with the nearest segment's tempo instead of clamping, so both
  directions stay monotonic and inverse everywhere.
- The `EnvelopeTime` exception (attack, release, impact durations, spec 36) is
  not defined here; this package names no plan or cue field with a `Seconds` or
  `Ms` suffix.

## Proof

- `src/beat.test.ts`: round trip over 10,000 generated variable-tempo grids
  within 1e-6 s (and 1e-9 beats), including samples outside the grid;
  monotonicity in both directions from beat -15 to 80; beat 1 to anchor
  `index 0` exactly; the documented edge policy at both ends; malformed PQTZ
  input rejected; empty grid rejected.
- Benchmark (P-74): 1,000,000 mappings on a 2,000-beat grid in **46.0 ms** on
  the reference Mac, asserted under a 250 ms ceiling.
- Full package run: 9 files, 54 passed, 1 skipped.

## Where this lives (deviation to record)

The plan puts the shared conversion in `packages/contracts/src/beat.ts` and the
`P-2.2` / `P-74` probe paths at `packages/contracts/src/beat.test.ts`. This
slice owns `packages/rekordbox-library` only, so the Beat domain is implemented
here; `packages/contracts/src/index.ts` still carries the 0-based,
clamp-style `sourceSecondsToBeat` / `beatToSourceSeconds`. The contracts owner
should either re-export this module or move it, and add the `P-73-beat-domain`
ast-grep rule (no field ending in `Seconds` or `Ms` in plan or cue types,
`EnvelopeTime` excepted), which does not exist in `tools/ast-grep/rules` yet.

## Delete test

Delete `src/beat.ts` and `src/beat.test.ts` fails to compile and every
assertion goes red. Weaken the edge policy back to clamping and the
round-trip property fails on the out-of-grid samples; restore the double
conversion in `toNativeBeat` and the PQTZ test reports `50000` instead of `50`.

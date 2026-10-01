# T-ROOM-09: Planner integration

Closes F-ROOM-02, spec 28 (spatial motif), 37.

## What changed

- This slice delivers the planner-side contract, not the planner itself (PlannerM3 owns generation): `PRIMITIVE_REGISTRY` metadata (energy, suitable sections, restraint costs, `needsClosedOrIndependent` for Orbit/PerimeterOrbit, `needsFixtureRateHz` for strobes), kebab-case plus legacy `section-look`/`chase-flip` alias resolution, and the `closed-loop`/`strobe` capability flags PlannerM3 sets on cues.
- Convention agreed with PlannerM3: builds use Fill from the far side or Converge meeting on the drop; drops use Ripple from the DJ plus fast Orbit; breakdowns use slow Orbit or Breathe; choruses reuse motifs reversed; mirrored strips never get Orbit.

## Proof

- `packages/show-planner/src/primitives.test.ts`: registry completeness (27 spec plus 23 spatial), per-primitive metadata, alias resolution, topology/rate gating.
- PlannerM3 validator consumes `isKnownCueType`/`resolvePrimitiveName` with fallback; `globalDesign.spatialMotif` records origin/direction/heads on their side.

## Delete test

Remove the `needsClosedOrIndependent` flag and the topology gate test goes red. Remove an alias and the kebab test goes red.

## Seams

PlannerM3 owns `index.ts` re-export and generation; this file stays the authority on names and requirements.

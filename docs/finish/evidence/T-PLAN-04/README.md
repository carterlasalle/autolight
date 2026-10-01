# T-PLAN-04: Primitive library

Closes F-PLAN-03, F-PLAN-15; probes P-31-primitive-registry, P-79-movement-vocabulary, P-ROOM-08 (registry third).

## What changed

- `packages/show-planner/src/primitives.ts` (new, owned exclusively per PlannerM3 split): all 27 spec-31 primitives plus all 23 WP05 spatial primitives, `MOVEMENT_VOCABULARY`, per-primitive coordinate/energy/sections/restraint/capability metadata, dependency-free interfaces plus defaults plus range validation (`parsePrimitiveParams`), kebab-case and legacy aliases, `UnknownPrimitiveError` on unregistered types, topology/rate gates.
- No zod dependency added (contracts owns validation; this file hand-rolls ranges so PlannerM3's package manifest is untouched).

## Proof

- `packages/show-planner/src/primitives.test.ts`: full registry list, metadata presence, defaults plus bad-value rejection, alias spellings, unknown-type error, topology/rate gates. Green (5 tests).

## Delete test

Delete any registry entry and the completeness test names it. Restore silent `undefined` for unknown names and the error test goes red.

## Seams

PlannerM3 adds the `index.ts` re-export and generation; renderer reads canonical names via local shapes (`primitive-params.ts`) with the registry as authority.

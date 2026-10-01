# T-PLAN-01: ShowPlan v2, typed cues and spatial selectors

Closes F-PLAN-02, F-PLAN-16, F-PLAN-18, F-PLAN-01 (identity use); probe `P-26, P-27, P-32, P-72, P-75`.

## What changed

- `src/types.ts`: `CompiledShowPlan` (spec 72 names plus `determinism`, `globalDesign`, `sections`, `recurrence`, `constraints`), `PlanCue` (stable `id`, six-level `level`, eight-layer `layer`, beats-only positions, `EnvelopeTime` attack/release in beats or ms, `reason`), `SpatialSelector` (groups, splits, zones, anchors, field predicates, union/intersection/difference; never device IDs), `VenueCapabilityClass`, `PlannerConfigSnapshot`, 11-property `PlannerStyle`, `fingerprintOf` injection.
- `src/compile.ts` `compileShow`: seed is `fnv` over the five determinism inputs (fingerprint, planner version, style, venue, config); `planId`/`seed` recorded in `determinism`.
- Legacy `planShow(track, style)` preserved as a thin wrapper (default venue + config, strips v2 metadata) so mixer/renderer/pipeline consumers compile unchanged.

## Proof

- `src/schema.test.ts`: spec 72 field presence, per-cue id/level/layer/reason/envelope shape, five-input determinism (change any one input, seed changes), fingerprint-identity (same pcmFingerprint with different DB ids gives identical seeds), no device refs and no seconds fields in cue types.
- Scoped run: `yarn workspace @autolight/show-planner run test` green (this session).

## Delete test

Mix the style hash out of the seed and the change-any-input case goes red. Return a device-ID string as a target and the no-device-refs case goes red. Add a `startSeconds` field to a cue and the beat-domain case goes red.

## Seams

Identity seam: `fingerprintOf` accepts `derivePlannerSeed` from `packages/track-identity` (T-ID-02) with no package dependency; default reads `pcmFingerprint`, else `fileHash`, else `id`. Registry seam: validator takes an injected `knownTypes` so RoomM4 `primitives.ts` stays the authority on names. Contracts schema untouched: legacy `ShowPlan` shape preserved for downstream packages.

# Show Planner

As-built: deterministic cue compiler (`packages/show-planner/`, SPEC §27).

## Contract

Same track + planner version + style + venue class → same ShowPlan
(§27). Seed = track fingerprint (never hand-set). Venue-independent
(§75): the planner emits against fixture classes, never device
internals — planner never imports govee or venue code.

Entry: `compile.ts` (`compile()`). Restraint budgets enforced per cue
kind (`restrain()` in `compile.ts`: chase / blackout / strobe-burst /
white-hit / dip draws against per-style budgets; overdraw substitutes or
skips with the reason recorded in `constraints.budgetsUsed /
budgetsRemaining`).

## Inputs / outputs

- In: TrackModel v2 (Zod `trackModelSchema` owns the shape;
  `fusion.build_track_model` is the only constructor — never hand-bump
  `schemaVersion`), style + palette, venue class.
- Out: ShowPlan (versioned cues: section-look, impact, chase, blackout,
  dip, white-hit, strobe-burst, …) consumed by `@autolight/show-runtime`
  (`evaluateCues`) and mixed across decks by `@autolight/show-mixer`.

Golden: planner golden (`test-fixtures/analysis/`, update only via
`yarn golden:update`).

## Related

- Analysis event vocabulary (build/drop/fake-drop, §§22–25):
  `analysis/src/autolight_analysis/structure.py`, `events.py`.
- Runtime overrides (`blackout` → zero frames): `packages/show-host/`
  `applyOverrides` / `blankFrames`.
- Primitives and restraint tuning: SPEC §§34–35, config keys under
  `packages/config/src/registry.ts` (`planner.*`, `style.*`).

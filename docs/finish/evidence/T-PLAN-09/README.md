# T-PLAN-09: Show styles

Closes F-PLAN-06, F-PLAN-17, F-APP-18; probe `P-135`.

## What changed

- `src/styles.ts`: all 11 spec 135 properties with the seven spec-named built-ins (Club, House, Festival, Lounge, Pop, Dark, Minimal); `src/config.ts`: every planner number in `PlannerConfigSnapshot` with registry-mirrored defaults, style-overridable per section.
- Compile reads every property: intensityRange clamps, darknessPreference scales shade-dip beats, spatialDensity shortens the chase period, colorSaturation drives chroma and third-colour odds, paletteChangeRate gates mid-motif repaints, movementDensity gates beat pulses, impactAggression scales drop strength, whiteHitFrequency/strobeFrequency gate hits/textures, symmetry pins targets, reactiveAmount scales pulse energy.
- Legacy 5-field `ShowStyle` lifts onto the nearest built-in.

## Proof

- `src/styles.test.ts`: seven built-ins each carry all 11 properties; all 11 properties move the plan in the expected direction (per-property metric: darkness by shade beats, aggression by intensity arc, rest by the composite); Dark out-darkens Festival, Minimal is sparser than Festival, Festival out-hits Dark.
- Red runs observed: three properties were unread (`paletteChangeRate`, `symmetry`, `reactiveAmount`) and two metrics were seed-noise dominated; all wired with targeted metrics.

## Delete test

Ignore any property in compile and its direction case goes red. Delete a built-in and the roster case goes red. Reintroduce a literal for a registry key and the config-mirror case (single source in `config.ts`) is violated.

## Seams

Custom styles persist via `show_styles` (T-DATA-02) and edit in the style editor (T-UI-14). No hardcoded planner numbers remain.

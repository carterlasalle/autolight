# T-PLAN-07: Consume every event with confidence and strength

Closes F-PLAN-09; probe `none (task-internal map)`.

## What changed

- `src/events.ts`: every TrackModel event type maps to planning behaviour (build/intensify/predrop-hold/drop/fake-hold/continuation/breakdown/reentry/vocal/fill/dip/bump/final-hit/outro-release/section-transition, plus soft landing for unlisted types); per-type `eventMinConfidence` floors; strength scales intensity; below half-floor is silence, below floor is softened, never nothing and never a full impact; low-confidence drop becomes a `reveal`, soft drop a full-colour `impact`; confident drops stay in the event layer while the drop engine adds hit plus body.

## Proof

- `src/events.test.ts`: one case per mapped type; low-confidence drop yields a reveal and a compile with zero white hits; strength ordering (weak fill dimmer than strong fill).
- Red runs observed: confident-dropestenull swallowed the event-layer impact (now kept); `pause` expectation corrected to the implemented `blackout`.

## Delete test

Map low-confidence drops to `white-hit` and the reveal case goes red. Drop strength scaling and the ordering case goes red. Delete any type arm and its map case goes red.

## Seams

Floors live in `PlannerConfigSnapshot` (`eventMinConfidence`, default 0.5). Fake-drop actuals come from `fake-drop.endBeat` where present.

# T-ROOM-03: Room editor UI

Closes F-VEN-02, F-ROOM-01, spec 98.

## What changed

- `apps/desktop/src/routes/venue/` (new, owned exclusively; `features/venue/` untouched per UiScreens split): `room-canvas.tsx` (top-down SVG outline, wall names, DJ anchor with facing arrow, center marker, dimension readout, numeric patch path), `mapping-wizard.tsx` (10 steps with direction radio and mirror-place count), `room-preview.tsx` (live cells from the real sampler plus beat control), `index.tsx` (`RoomVenueRoute`: width/ceiling/facing numeric fields plus save; keyboard-accessible alternatives for every drag).
- UiScreens owns `routes/index.tsx` wiring and `device-screens.tsx`; this slice exports `RoomVenueRoute` and never edits the route table.

## Proof

- `apps/desktop/src/routes/venue/room.test.ts`: editor renders numeric fields, wizard renders step 1 content, preview renders live cells plus beat control. Desktop scoped run green (3 tests).
- Draw a 5 m square, place DJ, save: state round-trips in memory; venue file export covers reload identity (T-ROOM-11).

## Delete test

Remove any numeric input and its assertion goes red. Remove the wizard step label and the step test goes red.

## Seams

Edits `Room` (T-ROOM-01) and launches the wizard (T-ROOM-04); preview reads `sampleSpatial` (T-REND-02).

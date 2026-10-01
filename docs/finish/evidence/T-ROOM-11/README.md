# T-ROOM-11: Venue persistence, import and export

Closes F-VEN-04.

## What changed

- `packages/venue/src/venue.ts` (new): `Venue` (room, fixtures, logicalZeroS, version), `exportVenue`/`importVenue` with format guard, `setLogicalZero` (persists across restart via the venue file), `switchVenue` rerender bump, `VENUE_TEMPLATES` (square loop, club rectangle, bedroom).

## Proof

- `packages/venue/src/venue.test.ts`: export/import round-trip, foreign-file rejection, logical-zero persistence.
- DB tables (`venues`, `fixture_placements`, `fixture_groups`, `device_calibrations`) are storage-layer work; the file is the backup path that never blocks setup.

## Delete test

Break the `structuredClone` round-trip and the equality test goes red. Accept any `format` and the rejection test goes red.

## Seams

Storage team owns table writes; this file is the serializable contract they store.

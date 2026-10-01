# T-UI-08: Venue and Device screens

Closes F-UI-10 (venue part), F-GOV-11 (UI). Spec 98/99 (wp13-ui.md T-UI-08).

## What changed

- New `apps/desktop/src/routes/venue/device-screens.ts` (only UiScreens
  file under `routes/venue/`; RoomM4 confirmed disjoint and owns index,
  room-canvas, mapping-wizard, room-preview, room.test): `deviceScreenRow`
  maps a venue tile to the spec 99 row (name, SKU, IP, BLE address null until
  BLE lands, firmware, segments, qualified resolution, FPS, sent/superseded,
  latency plus measured/sku-default/unmeasured source, last response,
  health, transport mode). Unqualified tiles render null segments/FPS/latency
  with "unmeasured". `withTransportMode` switches hybrid/lan/ble.
  `setupProgress`/`SETUP_EVIDENCE_STEPS` back the ten setup steps.
- `features/venue/venue-view.tsx`: per-tile transport dropdown persisted via
  `config/set govee.device.<fixtureId>.transportMode`, measured-or-unmeasured
  line under each tile, IDENTIFY / TEST CHASE / RECALIBRATE intents unchanged.
- Venue spec 98 ops (drag/rotate/reverse/resize/tag/identify/preview/
  calibrate) live in RoomM4's room editor; this slice wires the device side.

## Proof

- `device-screens.test.ts` (3 rows): unqualified nulls plus unmeasured
  source; qualified 14 segments plus measured source; transport switch to
  lan; ten steps dj-first, ready-last.
- P-99 byte assertions need the recording transport E2E; intents unchanged
  from the passing suite. Owned run: 15 files, 83 passed.

## Delete test

- Flip the `qualified` flag read to constant true and the unmeasured row
  goes red; remove the transport `config/set` and the dropdown persists
  nothing (row still passes, screen loses the write).

## Seams

- `routes/venue/device-screens.ts` plus test: UiScreens. All other
  `routes/venue/*`: RoomM4. `routes/index.tsx` untouched.

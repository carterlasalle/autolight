# Govee

As-built: segmented LAN streaming over the razer channel (SPEC §§44–55).

## Protocol

`packages/govee/src/razer.ts` owns the byte codec both engines share.
Frames are `BB <len_hi> <len_lo> <opcode> <payload> <xor>` (len = payload
length, 16-bit big-endian; xor covers every preceding byte including `BB`),
sent as UDP JSON envelopes to device port 4003:
`{"msg":{"cmd":"razer","data":{"pt":"<base64>"}}}`.

Opcodes (`OPCODE`): `ARM 0xb1`, `RGB_STREAM 0xb0`, `ZONED 0xb4`,
`ARM_STATUS 0xb2`. Ports (`PORTS`): discovery multicast 4001, response
4002, control 4003. Arm golden vector: `bb 00 01 b1 01 0a`.

## Arm / stream lifecycle

1. **Probe** (`probe.ts`, T-GOV-10): status → arm → settle → B2 read-back
   → two-colour paint → B4. A unit whose firmware ignores paint gets the
   SINGLE-ZONE badge; no frames stream.
2. **Arm**: `arm(true)` (B1), then wait the unit's `arm_settle_ms`
   (default 50 ms, toolkit lan.md §1; wizard step 12 measures per unit).
3. **Stream**: `paint()` (B0) per frame through `PacingStream`
   (newest-state-wins; superseded frames counted, never queued).
4. **Keepalive**: paced stream holds the channel; `turn` and white
   `colorwc` commands end the razer channel, so the show path never sends
   them while armed (T-GOV-08).
5. **Shutdown/disarm**: `disarmStreams()` → `arm(false)` (T-ARC-03,
   `apps/desktop/electron/show-service.ts`).

Byte-level fixtures: `protocol-fixtures/govee/razer/` (arm, B0 at 1/14/20/
60/120/255 zones × groups, B2, B4, disarm, armed status).

## Engines

`packages/govee/src/engines/`: `govee.lan.engine` takes `toolkit`,
`native-ts`, or `auto` (default). `auto` runs the toolkit addon primary
and falls back per device to the native TypeScript codec on load failure
or device error — a typed reason on the device tile, never silent
(T-GOV-03, ADR-003). Byte parity between engines is tested.

## Transport failover

`packages/failover/src/transports.ts` (T-FOV-01, SPEC §148): six-transport
union `lan-razer`, `lan-json`, `ble-segmented`, `ble-single`, `matter`,
`cloud-metadata`. Per-fixture ordered `transportOrder` plus a capability
record per transport from qualification; per-device
`transportMode` (DS-31: `auto` / `hybrid` / pinned). Policy
fallback with a visible banner. Cloud never carries frames (runtime
invariant T-TRU-12). `machine.ts` (T-FOV-02) owns LAN-loss detection and
bar-boundary switch-back; every switch is logged, shown, and reversible.

Full priority table: `docs/finish/wp04-ble-matter-cloud-failover.md`
(T-FOV-01 section).

## Invariants

- Blackout = RGB 0,0,0, never power-off (SPEC §47, `blackoutPayload`).
- White hits = RGB(255,255,255) scaled in linear light (SPEC §§48–49,
  `whiteHitPayload`, `scaleChannel`); per-frame intensity scales RGB, the
  brightness wire stays quiet (T-GOV-09).
- Per-device latency compensation (SPEC §55): `rttMs` per device in
  `readDiagnostics`.
- Firmware change → requalification of steps 8, 9, 12, 13 before segmented
  streaming resumes (SPEC §147, `REQUIRED_AFTER_FIRMWARE_CHANGE`).

## Qualification

`docs/qualification.md` (SPEC §52 procedure); wizard runner
`packages/govee/src/qualification.ts`; device profiles `devices/H6076.yaml`,
`devices/H1A45.yaml` (measured values per unit, never SKU-assumed).

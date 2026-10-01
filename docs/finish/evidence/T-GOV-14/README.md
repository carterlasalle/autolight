# T-GOV-14: Simulators and recording transports

Closes F-QA-12, F-GOV-23. Verifies the T-GOV-02 codec slice in passing.

## What was built

- `packages/simulator/src/govee-lan.ts` (new): `GoveeLanSim`, a virtual lamp
  on loopback UDP. Answers scan, the four official commands, devStatus,
  status with B2, razer arm, B0 and B4 paint, and disarm. Configurable traps
  mirror real hardware: third back-to-back datagram dropped, turn ends the
  channel, white kelvin colorwc ends the channel, no status or devStatus
  while armed, rate ceiling with stutter (40 Hz at 20 zones, 25 at 60,
  20 at 120, 10 fallback), arm settle (paint inside the window lost),
  packet loss, latency, jitter, duplication, reorder hold, disappearance,
  and IP change. `rendered` exposes zone colors for assertions and the
  Simulator mode preview; `metrics` counts datagrams, drops, applied and
  stuttered paints, and status queries.
- `packages/simulator/src/recording.ts` (new): `RecordingTransport` wraps a
  sender and records every datagram with timestamps plus a kind classifier
  (scan, turn, brightness, colorwc, devStatus, status, razer, other).
  `FaultInjectingTransport` replays drop, duplicate, latency, and reorder
  faults in front of any sender.
- `protocol-fixtures/govee/razer/` (new): 18 vectors plus a status reply and
  a README. Arm, disarm, B0 with 1, 14, 20, 60, 120, 255 zones at gradient
  0 and 1, two B4 examples, B2 armed and disarmed frames. Every row carries
  byte-exact hex plus base64.
- `packages/govee/src/index.test.ts` (extended): arm golden vector
  byte-exact, every fixture re-encoded byte-exact through decode plus
  encode, a 200-round decode(encode(x)) property test with checksum
  rejection on corruption, envelope and parseStatus edges. The stale
  collapse test now names single-zone as the T-GOV-10 verified fallback,
  not the default path.

## What passes today vs what waits

- Passes today: `packages/govee` 14 tests, `packages/simulator` 16 tests,
  both typechecks clean. Contract tests run the simulator on real loopback
  UDP: scan reply, arm plus B0 paint plus B2 armed flag, B4 zoned paint,
  back-to-back drop, turn and white end the channel, status silence while
  armed, settle loss plus ceiling stutter, disappearance plus IP change,
  recording classification with timestamps, zero turns after arm,
  fault-injection drop plus duplicate plus reorder plus latency, corrupt
  checksum rejection. T-GOV-02 is verified in place: the codec is preserved
  with real behavior and failing-capable tests, so its row can move with
  this evidence attached.
- Waits on hardware: no claim is made about hardware. Simulator runs prove
  code, never hardware. T-GOV-10 still owns deleting `collapseToSingleColor`;
  this task only reframed its test.

## Proof

- `yarn workspace @autolight/govee test`: 1 file, 14 tests passed.
- `yarn workspace @autolight/simulator test`: 2 files, 16 tests passed.
- Both `tsc --noEmit -p tsconfig.json` runs print nothing (clean).
- Red run: the new arm, decode, and fixture tests fail against the
  committed HEAD codec, which exports no `arm()` or `decodeRaw()` and whose
  old `encodeFrame(B1, [01])` yields `bb03b101b3` instead of the pinned
  `bb0001b1010a`. Verified by evaluating the HEAD source from git in this
  session: `old encodeFrame(B1,[01]) = bb03b101b3 (expected bb0001b1010a)`,
  `RED CONFIRMED: new arm/decode tests fail against HEAD codec`.

## Delete test

Delete `packages/simulator/src/govee-lan.ts` and the simulator contract
tests fail to import. Corrupt one byte of `protocol-fixtures/govee/razer/arm.json`
and the fixture re-encode test goes red. Reintroduce the old 1-byte length
in `encodeRaw` and the arm vector plus all 18 fixture vectors go red.
Remove the back-to-back counter and the drop test goes red. Answer status
while armed and the silence test goes red.

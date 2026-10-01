# T-GOV-03: Engine switch DS-02 and parity

Closes DS-02. Verified on the simulator only: no claim is made about hardware.
Simulator runs prove code, never hardware.

## What was built

- `packages/govee/src/engines/index.ts` (new): `EngineSelector` and
  `createEngineSelector`, the DS-02 switch.
  - `mode`: `toolkit`, `native-ts`, `auto`.
  - `auto` attempts the toolkit load once, up front, so a show has one engine
    decision and one recorded load result. Load ok: the toolkit is primary.
    Load failed: every device tile carries the typed reason
    (`report().reason`, `decision(deviceId).reason`).
  - `toolkit` mode throws `ToolkitLoadFailure` with the same typed reason
    instead of downgrading. A silent fallback is never taken.
  - Per device on a toolkit error: `openStream(deviceId)` catches the failure,
    records `{ engine: "native-ts", reason }` for that device only, and retries
    it on the native engine. The reason text is
    `toolkit stream error: <detail>` or
    `toolkit addon unavailable in this context: <detail>` when the failure is a
    typed addon-unavailable error. Other devices keep the toolkit.
  - `decision(deviceId)`, `summary()` and `report()` are the device-tile
    surface for "native engine (reason)".
- `packages/govee/src/razer.ts`: `EngineKind`, `EngineMode`,
  `UnavailableReason` and `reasonText`, the vocabulary the switch and the tile
  share.
- `packages/govee/src/index.ts`: exports the switch, the engines and their
  types from `@autolight/govee`.

## Parity test (green)

`parity: toolkit and native-ts send the same datagrams and hold the same
counters` drives one scripted sequence through both engines on separate
deterministic clocks: paint `a`, paint `b`, repeat `b` (unchanged), then `c`
superseded by `d`, then `e`, then close. Both engines produce, byte for byte
and in order:

```
arm(true) bb 00 01 b1 01 0a
B0 a, B0 b, B0 d, B0 e   (4-zone frames, gradient 0)
arm(false) bb 00 01 b1 00 0b
```

Asserted: `expect(toolkitSink.datagrams).toEqual(nativeSink.datagrams)` on the
datagram text, the decoded frame hex list against
`hexOf(paint(frame, 0))`, the arm and disarm vectors, and the counters
`framesRequested 6, framesSent 4, framesSuperseded 1` on both engines. Timing
is the only difference, which is what parity modulo timing means.

`both engines against the LAN simulator paint identically` sends the same four
frames through each engine to a real `GoveeLanSim` on loopback UDP and asserts
equal `paintsApplied` (4), equal `rendered` zone colours (the last frame), the
disarm observed (`armedState` false after close), and one socket per device for
every frame.

## E2E note: flipping the switch mid-show

A flip costs at most one arm-settle gap per device. `close()` sends the disarm
(the channel ends and the unit returns to its own colour), and the next
`openStream()` arms and waits the unit's measured arm settle before the first
paint, so a device loses one settle window and nothing else. The test
`a mid-show flip costs one arm-settle gap per device` pins the bytes: the
toolkit stream writes `arm(true), B0 a, arm(false)`; the native reopen writes
`arm(true)` immediately and no paint until the settle timer elapses (at 19 of
20 ms the wire holds only the arm frame), then exactly one `B0 e`. No second
re-arm, no queued frame from the old engine, no other engine on the device.

The host wiring (reading `govee.lan.engine` from the config catalog and
constructing the selector) lives in the desktop show host, outside this slice's
paths. The catalog row already exists (`packages/config/src/registry.ts`,
default `auto`, enum DS-02) and `createEngineSelector({ mode })` takes the
value.

## Metrics (per engine, measured this session)

| Engine | Counter receipt | Load | Stream open |
| --- | --- | --- | --- |
| toolkit | requested 6, sent 4, superseded 1 (binding counters) | 0.13 ms with the local loader | 0.277 ms |
| native-ts | requested 6, sent 4, superseded 1, missed 1 after a stall | n/a (in process) | 0.712 ms |

The toolkit row's load and open numbers are with the loader plumbing in place,
not with the native addon: `node_modules/govee-toolkit` is absent on this
machine, so the addon's real `dlopen` and stream-open times are unmeasured and
the evidence says so instead of guessing.

## Proof

- `vitest run --root packages/govee`: 1 file, 21 tests passed. The T-GOV-03
  tests are the parity test, the missed-tick test, the `auto` load fallback,
  the `toolkit` mode failure, the per-device error fallback and the mid-show
  flip.
- `packages/govee/node_modules/.bin/tsc --noEmit -p tsconfig.json`: no output
  (clean).
- Load-failure receipt: `auto` with a loader throwing
  `dlopen(govee_toolkit.node): image not found` yields
  `currentKind() === "native-ts"` and
  `report().reason === "toolkit addon failed to load: dlopen(govee_toolkit.node): image not found"`.

## Delete test (byte level)

Delete `packages/govee/src/engines/index.ts` and the `auto`, `toolkit`,
per-device fallback and flip tests fail to import. Make `EngineSelector`
downgrade silently instead of throwing in `toolkit` mode and the
`expect(selector).rejects.toBeInstanceOf(ToolkitLoadFailure)` assertion goes
red. Read the toolkit stream's failure but skip `noteFallback` and
`decision("BAD:01").reason` loses the `toolkit stream error` text the tile
shows. Hand the flip's new stream to the toolkit engine again instead of the
recorded override and the wire would carry a second `arm` from the toolkit
binding while the native assertion expects exactly one arm frame and no paint
before the settle, so the flip test goes red on bytes. Make `openStream` arm
and paint in the same tick (drop the settle wait) and the flip test's
`expect(nativeSink.datagrams.length).toBe(1)` after 19 ms goes red, which is the
arm-settle-gap guarantee the E2E note claims.

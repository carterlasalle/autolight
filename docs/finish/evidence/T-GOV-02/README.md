# T-GOV-02: Native TypeScript razer engine

Closes F-GOV-02, scar S20. Verified on the simulator only: no claim is made
about hardware. Simulator runs prove code, never hardware.

## What was built

- `packages/govee/src/razer.ts` (new): the seam both engines share.
  - The byte codec moved here unchanged from `index.ts` and stays
    `@autolight/govee`'s public surface through re-export: `encodeRaw`,
    `decodeRaw`, `envelope`, `arm`, `paint`, `paintZoned`, `parseStatus`,
    `OPCODE`, `PORTS`, so the existing golden-vector and property tests did
    not move with it.
  - The four official LAN commands plus `parseDevStatus` also moved here
    (`turnCommand`, `brightnessCommand`, `colorCommand`, `devStatusCommand`),
    because the engine writes them and `index.ts` re-exports them.
  - `LanStreamEngine`, `StreamOptions`, `EngineMetrics`, `EngineHealth`,
    `EngineStatus`, `EngineReport`, `SegmentStreamLike`, `Scheduler`,
    `WALL_SCHEDULER`.
  - `PacingStream`: fixed interval emitter, newest frame wins, an unchanged
    frame is not re-sent, a missed tick is skipped instead of burst, a
    superseded frame is counted, frames are copied into the engine's own
    buffer on `setAll`, `B1 arm` goes out when the stream opens, `B1 disarm`
    goes out on `close` and no handle can flush afterwards.
- `packages/govee/src/engines/native-ts.ts` (new): `NativeStreamEngine` plus
  `SocketTransport`.
  - `SocketTransport` opens one UDP socket per device on the first send and
    reuses it for every command and frame (`openSockets` reports the count, so
    the T-GOV-04 socket-count test can assert it). Send errors are recorded per
    device for `health()` instead of killing the process, and the engine closes
    only the sockets it owns.
  - The transport is injectable (`StreamTransport`: `sendRaw` for razer frames,
    `sendJson` for the official commands) and matches the govee-manager shape
    (`sendToDevice(mac, text)`, `sendRazer(mac, raw)`), so production wires the
    manager's bound methods in and the package keeps no dependency on
    `apps/desktop`. A transport that also exposes `status(deviceId, timeoutMs)`
    (the manager's `requestDevStatus`) serves `status()`; without a reply
    socket the engine answers `null` rather than a fabricated state, because
    the reply socket belongs to the manager (T-GOV-04) and the retry policy to
    T-GOV-07. Silence while armed is not treated as a failure.
  - `identify()` flashes through the open stream when armed and restores the
    show frame after the flash window, otherwise it uses `turn` plus RGB white
    `colorwc` with kelvin 0. `segment()` paints once through a one-shot stream
    (arm, settle, paint, hold, disarm), reusing the same loop so the arm and
    disarm semantics cannot drift.
  - `metrics(deviceId)` reports `framesRequested`, `framesSent`,
    `framesSuperseded`, `missedTicks` and `effectiveHz` per device.
- Fallback rate: unmeasured units run at 10 Hz (`fallbackRateHz`), never at the
  renderer's 60 (toolkit lan.md 2.3).
- `packages/govee/src/index.ts`: re-exports the engine, its transport and the
  seam, and keeps `encodeFrame` as the one legacy alias until its owner deletes
  it.

## What passes today vs what waits

- Passes today: the codec stays byte-exact against all 18 committed fixtures
  plus the arm golden vector and the 200-round property test; the pacing
  semantics and the simulator run in this task's tests; the parity proof in
  `docs/finish/evidence/T-GOV-03/README.md` drives this engine against
  govee-toolkit's binding behaviour with identical datagrams.
- Waits on T-GOV-04/06/07: the manager's bound senders, per-device address
  resolution, read-back and backoff. The engine's `resolve` hook and
  `StreamTransport` seam are the injection points; nothing opens a socket per
  send and there is no `child_process` in the package.
- Waits on hardware: arm settle, frame-rate table rows and native resolution
  are the qualification wizard's numbers (T-GOV-11); this engine only honours
  them.

## Metrics (measured this session)

| Metric | Value | How |
| --- | --- | --- |
| Parity counters, native | requested 6, sent 4, superseded 1 | deterministic script, asserted |
| Parity counters, toolkit | requested 6, sent 4, superseded 1 | same script, asserted equal |
| Missed ticks | 1 after a 250 ms stall at 10 Hz | asserted, skipped not burst |
| Stream open (native) | 0.712 ms | stub transport, local run |
| Simulator run | 4 paints applied, 1 socket then 0, disarm observed | real loopback UDP |
| Effective rate | 20 Hz configured, unchanged | asserted |

## Proof

- `vitest run --root packages/govee`: 1 file, 21 tests passed, including
  `parity: toolkit and native-ts send the same datagrams and hold the same
  counters`, `skips missed ticks instead of bursting them`, and
  `both engines against the LAN simulator paint identically` (4 paints, the
  last frame's zone colours rendered, disarm seen, one socket for every frame).
- `packages/govee/node_modules/.bin/tsc --noEmit -p tsconfig.json`: no output
  (clean).
- Fixture receipts: the arm golden vector is still `bb 00 01 b1 01 0a`, and
  every file in `protocol-fixtures/govee/razer/` still re-encodes byte-exact
  through the moved codec.

## Delete test (byte level)

Delete `packages/govee/src/engines/native-ts.ts` and the parity, flip and
simulator tests fail to import (`NativeStreamEngine`, `SocketTransport`).
Drop the `hex === this.lastSentHex` check in `PacingStream.emit` and an
unchanged frame is written again, so the parity datagram array gains a second
`B0` frame for the repeated frame and
`expect(toolkitSink.datagrams).toEqual(nativeSink.datagrams)` goes red on
bytes, not on timing. Remove the superseded increment in `setAll` and the
`framesSuperseded: 1` assertion goes red for both engines. Make `close()` skip
the disarm and the flip test and the simulator test go red (`armedState` stays
true after close). Ignore the `behind` computation in `emit` and the
`missedTicks: 1` assertion goes red after the 250 ms stall. Create a socket per
send in `SocketTransport` and the simulator run's `openSockets` assertion goes
red at 1 before close. Put the 1-byte payload length back into `encodeRaw` and
the arm vector plus all 18 fixtures go red (the T-GOV-14 fixture test).

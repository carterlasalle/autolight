# T-GOV-08: Stream lifecycle and newest-frame-wins

Closes F-GOV-03, F-GOV-13, F-GOV-14, F-GOV-22, F-GOV-23, spec 46, 51, 106, 107, 149.

## What was built

- `ensureArmed` turns on only before arming (never while armed), arms with
  B1, and waits the measured settle (`govee.lan.arm.settleMsDefault`); a
  paint inside the settle window is lost hardware behavior, so the wait is
  load-bearing.
- `openStream` builds a `PacingStream` (fixed interval emitter, unchanged
  frames not re-sent, missed ticks skipped never burst, superseded counter,
  disarm on close) at the qualified rate capped by `govee.lan.stream.targetHz`
  with the `govee.lan.stream.fallbackHz` floor. Frames are copied on `setAll`.
  IDENTIFY and TEST CHASE ride the stream when armed.
- Non-stream commands to one device serialize through a per-device chain with
  `govee.lan.command.minSpacingMs` spacing (three back-to-back datagrams lose
  the third). `close()` cancels pending frames, disarms, and the handle cannot
  flush afterwards. Reconnect re-arms, waits settle, and sends the current
  frame only, inside `govee.lan.reconnect.maxMs`.

## What passes today vs what waits

- Passes today: simulator smoke opens a 2-zone stream, pushes 300 frames,
  and the socket count stays fixed; the recording-transport zero-turn proof
  and the 10-minute SIM show belong to the orchestrator.
- Waits on the orchestrator: `P-47`, `P-51`, `P-106`, `P-107` in SIM plus the
  recording transport showing zero turn commands and zero stale frames.

## Proof

- `node --experimental-strip-types` smoke: 300 `pushFrame` calls through one
  `PacingStream` hold the socket count at 1 reply plus sends; the sim renders
  the latest paint.

## Delete test

Drop the arm-settle wait and paints inside the window never land on the sim.
Remove the per-device chain and three rapid commands lose the third against
the sim's back-to-back trap. Reopen without sending the current frame and the
reconnected sim renders stale black.

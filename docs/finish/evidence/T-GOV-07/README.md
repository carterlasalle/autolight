# T-GOV-07: Read-back

Closes F-GOV-08.

## What was built

- `GoveeLanManager.requestDevStatus` sends `devStatus` from the reply socket
  (so replies route back to the waiter) and resends every
  `govee.lan.status.retryMs` until `govee.lan.status.deadlineMs`. Replies are
  routed by sender IP against the MAC entry plus its IP history; the parsed
  state becomes `observed` with RTT, resetting consecutive failures.
- Waiters filter by command, so scan chatter never resolves a status wait.
  Silence while armed returns `skippedWhileArmed` immediately: a unit may not
  answer `status` or `devStatus` while armed, which is not a device failure.
- The Diagnostics copy reports exactly what was verified: `observed` per
  device plus a `readBackVerified` count of devices with non-null observed
  state. Unanswered devices keep `observed: null`, never a fabricated state.

## What passes today vs what waits

- Passes today: simulator smoke reads back `onOff: true` in 1 attempt with
  1 ms RTT while disarmed, and returns `skippedWhileArmed` without sending
  once the stream is armed.
- Waits on the orchestrator: delayed and dropped reply SIM tests and the
  observed-versus-requested UI tiles.

## Proof

- `node --experimental-strip-types` smoke against `GoveeLanSim`: disarmed
  read-back answered true on attempt 1; after `openStream` the same call
  returns `{ answered: false, skippedWhileArmed: true }`.

## Delete test

Send the status request from the send socket and the disarmed read-back never
answers (replies route to the reply port). Remove the command filter and a
scan reply resolves the waiter with a parse miss. Treat armed silence as
failure and the armed device flaps to degraded mid-show.

# T-GOV-04: Persistent sockets

Closes F-GOV-06, F-GOV-13 partial.

## What was built

- `apps/desktop/electron/govee-lan.ts` (rewritten): `GoveeLanManager` owns one
  UDP socket bound to `govee.lan.ports.reply` (4002) for discovery plus status
  replies routed by sender IP, and one send socket per interface reused for
  every command and frame. No socket is created per send. No `child_process`
  anywhere in this path (the old `sendToDevice` spawned `node -e` per
  datagram; it is deleted).
- A 4002 bind conflict (`EADDRINUSE`) throws loudly naming the likely holders
  (Govee Desktop, homebridge-govee, SignalRGB, Govee LAN Control, another
  AutoLight instance) and the fix; `portStatus()` surfaces it for Devices and
  Diagnostics.
- `apps/desktop/electron/show-service.ts` (govee sections only): `scanLanCommand`,
  `identifyCommand`, `testChaseCommand`, `pushFrame`, crash, ending-look,
  shutdown disarm, `readDiagnostics`, and `readVenueList` are thin wrappers over
  the manager singleton. `ipc.ts` and `main.ts` untouched.

## What passes today vs what waits

- Passes today: simulator smoke (loopback UDP) shows the socket count fixed at
  1 reply plus 1 send socket after 300 pushed frames; `grep child_process`
  over both owned files is empty; `EADDRINUSE` mapping reviewed in code.
- Waits on the orchestrator: the 10,000-frame socket-count gate and the
  port-conflict E2E with a dummy listener (`P-106-device-loss` socket leg).

## Proof

- `node --experimental-strip-types` smoke against `GoveeLanSim`: discovery,
  open stream, 300 `pushFrame` calls, socket count 1 before and after.
- `grep -n child_process apps/desktop/electron/govee-lan.ts
  apps/desktop/electron/show-service.ts`: no hits.

## Delete test

Delete `openSenders` reuse (create one socket per `sendJson`) and the fixed
socket-count smoke goes red. Reintroduce the `node -e` spawn in `sendToDevice`
and the zero child process grep goes red. Occupy 4002 with a dummy listener
before `start()` and startup throws the holder-naming message.

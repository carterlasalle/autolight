# T-GOV-06: Device registry and health

Closes F-GOV-09, F-GOV-13, F-RUN-10 partial.

## What was built

- MAC-keyed registry in `GoveeLanManager`: MAC, SKU, BLE and Wi-Fi versions,
  name, IP history (last 8), last seen, finding rung, per-transport health
  (last success, last failure, consecutive failures, RTT), requested versus
  observed state with generation counters, reconnect count.
- The UI and IPC use the MAC everywhere: `venue/scan` returns `id: mac`,
  `venue/identify` and `venue/test-chase` take the MAC, `readVenueList`
  emits MAC ids. The old IP-keyed `deviceIps` mismatch is gone.
- Per-device FPS backoff halves only that device's rate down to
  `govee.lan.backoff.minFps`; the logical show rate is untouched. Reconnect
  re-arms, waits the settle, and sends the current frame only, inside the
  `govee.lan.reconnect.maxMs` budget with a warning when it overruns.
- Persistence is a JSON file under userData (`govee-registry.json`, beside
  `config.json`) until the storage service lands device tables (T-DATA-02).
  This is the honest interim: the code states it in the header and saves
  beside the config; no DB table is claimed.

## What passes today vs what waits

- Passes today: simulator smoke with two MACs on one sender IP; backoff on
  device 1 halves only device 1 (10 to 5 fps) while device 2 stays online at
  10 fps.
- Waits on the orchestrator: IDENTIFY reaching the right device in E2E and the
  throttled-device backoff probe (`P-107-congestion`).

## Proof

- `node --experimental-strip-types` smoke: two injected MACs coexist;
  `backoff(mac1)` twice yields fps 5 on mac1, fps 10 and health online on mac2.

## Delete test

Key the registry by IP and the two-MAC smoke collapses to one entry. Make
`backoff` touch a shared rate and device 2 drops with device 1. Point the
registry path at an unreadable file and startup warns instead of crashing.

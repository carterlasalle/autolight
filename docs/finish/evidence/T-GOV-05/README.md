# T-GOV-05: Discovery ladder

Closes F-GOV-07, F-GOV-25, DS-16.

## What was built

- Rungs in `GoveeLanManager.round()`, each gated by its own setting
  (config 3.6): multicast `239.255.255.250:4001` with
  `setMulticastInterface` per eligible interface
  (`govee.lan.discovery.multicast`), per-interface directed broadcast
  computed from address plus netmask
  (`govee.lan.discovery.perInterfaceBroadcast`), global broadcast
  (`govee.lan.discovery.globalBroadcast`), explicit scan list with per-round
  DNS resolution (`govee.lan.discovery.scanList`), cached-IP unicast from the
  MAC-keyed registry.
- Retry doubles `retryInitialMs` toward `retryMaxMs` without stopping; the
  background timer (`backgroundRescanMs`) resets the cadence; interface
  signature changes and `notifyResume` rescan immediately.
- Replies without `ip` are accepted via the sender address; a disagree
  between claimed and sender IP warns (govee2mqtt issue 437) with a fix hint.
  Devices are keyed by MAC (`device` field), never by IP; the rung that found
  each device is recorded.

## What passes today vs what waits

- Passes today: simulator smoke with multicast and both broadcasts disabled
  and only the scan list rung on still discovers the sim; the injected second
  MAC over the same sender IP registers as its own device.
- Waits on the orchestrator: per-rung SIM isolation (multicast blocked,
  broadcast blocked, unicast only), reply without `ip`, rung per device in E2E,
  network-change rescan timing.

## Proof

- `node --experimental-strip-types` smoke: scan-list-only discovery returns
  the sim MAC; a second injected scan reply from the same sender IP appears
  as a second MAC-keyed entry.

## Delete test

Disable the scan-list rung with a sim reachable only by unicast and discovery
returns empty. Drop the sender-address fallback for replies without `ip` and
an ipless reply is rejected. Key by IP instead of MAC and an IP change
duplicates the device.

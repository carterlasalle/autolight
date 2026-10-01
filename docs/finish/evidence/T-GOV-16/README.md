# T-GOV-16: Network hygiene and trust status

Closes F-GOV-20, F-GOV-26, spec 111.

## What was built

- `apps/desktop/electron/govee-lan.ts` (hygiene section only):
  `isPrivateIpv4` (RFC 1918: 10/8, 172.16/12, 192.168/16),
  `subnetAddress`, `firewallHints(darwin|win32|linux)`.
- `eligibleInterfaces` now refuses every non-private address even when
  `govee.lan.interfaces` selects that interface name: the refusal is
  recorded in `refusedWan` and the address is never bound, never sent
  from, and never joined to multicast. Loopback still needs the explicit
  `loopbackScan` flag (simulator and tests); link-local stays excluded.
- `start()` records per-interface multicast join results in `multicastOk`;
  `stop()` clears them. `applyLiveTunables` accepts `interfaces` and
  resets the interface signature so the next round rescans.
- `networkTrust()` is the single source the Diagnostics network tab
  renders: bound interfaces with subnet and broadcast, refused WAN
  interfaces, per-interface multicast health, client-isolation suspects
  (a registry device on a bound subnet gone offline while rounds run),
  the six-item SignalRGB checklist (LAN toggle, same subnet, multicast,
  guest network, isolation, firewall), and per-OS firewall hints.

## What passes today vs what waits

- Passes today: 20-check strip-types smoke (below): all RFC 1918
  boundaries, CGNAT and malformed rejection, subnet math, per-OS hints,
  zero WAN addresses bound on this host, six checklist items, and
  loopback simulator discovery through `scanOnce` with `loopbackScan`.
- Waits on the orchestrator: Diagnostics network tab rendering (UI
  slice), E2E with SIM (`P-111-trust`), HW runbook on a real subnet.

## Proof

- `node --experimental-strip-types` smoke: 20 checks, 0 failures
  (helpers, no-WAN-bound on this host, checklist shape, SIM discovery
  of `AA:BB:CC:DD:EE:01` via scan-list-only plus loopback flag).

## Delete test

Remove the `isPrivateIpv4` refusal in `eligibleInterfaces` and the
no-WAN-bound check goes red on any host with a public or CGNAT
address. Drop the `multicastOk.set` calls in `start()` and the
multicast checklist row reports ok on an interface whose join failed.
Delete the offline-device suspect loop and a cached device on a bound
subnet that stops answering no longer appears in `isolationSuspects`.

## Seams

- `GoveeLanManager.networkTrust()` is the only trust source; the
  Diagnostics tab must render it, not recompute it.
- `optionsFromConfig` already reads `govee.lan.interfaces`; no config
  change was needed.

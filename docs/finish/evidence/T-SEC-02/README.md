# T-SEC-02: Network exposure

Closes F-GOV-20 (binding part); probe `P-110-security`; wp14 section
T-SEC-02; spec 110, 111.

## What changed

- `packages/storage/src/netaudit.ts` (new): `auditListeners` checks every
  bound listener. Loopback passes. Non-loopback passes only for the Govee
  UDP ports (4001 scan, 4002 reply, 4003 control) and the discovery
  protocols that require LAN (PRO DJ LINK, Serato Remote Bonjour
  `_SeratoIOSRemote._tcp`, OS2L), each with its reason. Anything else is
  denied with a naming reason. `oscMustRefuseRemote` is the OSC default:
  non-loopback OSC bindings are refused.
- No externally reachable control server by default; no command bridging
  to other networks. The allowed list is the Diagnostics network trust
  content.

## Proof

- `packages/storage/src/ops.test.ts` (network block, 2 tests): loopback
  OSC plus Govee 4001 plus PRO DJ LINK discovery allowed, a 0.0.0.0:8080
  control server denied by name; non-loopback OSC refused while loopback
  passes, and a loopback-only OSC bound wide is denied.
- `yarn workspace @autolight/storage run test`: 10 files, 73 tests passed.

## Delete test

Delete the 4001 to 4003 allowance and the Govee listener is denied.
Delete the discovery-name match and the PRO DJ LINK listener is denied.
Allow all non-loopback and the control-server test stops failing.

## Seams

The Electron listener inventory (actual bound sockets per service) feeds
`auditListeners` and Diagnostics renders the allowed list with reasons.
The P-110 port scan from another host runs at qualification time.

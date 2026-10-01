# T-GOV-09: Blackout, white, intensity and master brightness policy

Closes F-GOV-05, F-GOV-16, F-GOV-30, spec 47, 48, 49, 50, DS-27.

## What was built

- Blackout is an all-zero frame on the armed stream (`blackoutPayload`),
  sent immediately for latency and into the paced stream to cancel stale
  frames. No `turn` is ever sent while armed. Crash, ending-look, and
  shutdown disarm paths all call `blackoutAll`, never `turn(false)`.
- White hits are RGB white scaled in linear light (`whiteHitPayload` with
  `scaleChannel`, gamma 2.2), never kelvin `colorwc` while armed. Intensity
  is RGB scaling in the same linear light (`scaleFrame` in show-service).
- Global `brightness` travels only the slow rate-limited path
  (`govee.brightness.maxPerMinute`, default 6): `setBrightness` sends at most
  one command per window and coalesces the rest to the latest value. Show
  frames never emit brightness commands, so a beat can never become a
  `brightness` datagram. H1A45 stays on the default `rgb-white` (DS-27); the
  `white-channel` mode is a qualification experiment elsewhere, never here.

## What passes today vs what waits

- Passes today: simulator smoke blacks out a 2-zone stream to zeros with the
  channel still armed; no `turn` datagram exists in the blackout path.
- Waits on the orchestrator: `P-47`, `P-48`, `P-50` on the recording
  transport and emergency blackout latency `P-94`.

## Proof

- `node --experimental-strip-types` smoke: after `blackout`, the sim renders
  `[[0,0,0],[0,0,0]]` and the registry still reports `armed: true`;
  `grep turnCommand apps/desktop/electron/show-service.ts` shows no
  blackout-path sender.

## Delete test

Replace the zero frame with `turn(false)` and the armed sim drops its channel
(`turnEndsChannel` trap). Send kelvin `colorwc` while armed and the channel
drops (`whiteEndsChannel` trap). Emit brightness per frame and the 60 s
`P-50` count exceeds `govee.brightness.maxPerMinute`.

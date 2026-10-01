# T-SER-01: serato-connect Remote provider

Closes F-SER-01; probe `P-3.1-serato-connect`.

## What changed

- `packages/serato/package.json` (SeratoM2 owns this dependency decision):
  `serato-connect@^1.4.6` plus `@autolight/rekordbox-live` and
  `@autolight/rekordbox-library`; `@autolight/storage` as a dev dependency for
  the shared replay harness.
- `packages/serato/src/remote-provider.ts` (new): `SeratoRemoteProvider`
  implements the provider contract by wrapping `serato-connect`'s
  `SeratoRemoteClient`. Per spec 3.1 nothing about the wire is reimplemented:
  the Bonjour `_SeratoIOSRemote._tcp` advertisement, the inbound TCP stream,
  OSC 1.1, the 16-byte frame sentinel, the challenge and response handshake,
  four decks and the track-load settle window all stay in the dependency. The
  wrapper adds only what the app contract needs: `ProviderBase` lifecycle,
  `DeckGenerationMapper` generation bumps, `sourceIds.seratoPath` on the track
  identity, `master: null` (the protocol reports no master deck),
  `quality.playing = derived` from `playRate !== 0`, loop plus loop-roll
  mapping, per-deck update rate, and the setup snapshot.
- `ingestFrame(bytes)` accepts already-framed bytes, applies every message of a
  load burst, then publishes one state per touched deck. That is the path the
  replay harness drives, and `capture.test.ts` proves it lands on the same
  states the live client emits.
- Field coalescing on track change (spec 120 item 14): when the track identity
  changes, loop, roll and playhead are cleared, and values asserted after the
  change in the same burst survive. A playhead sampled within 100 ms of a load
  belongs to the new track and is kept; an eject clears everything
  track-scoped.
- `packages/serato/src/setup.ts` (new): `checkSeratoSetup` reports seven
  steps (serato.remote.enabled, installation, advertisement, connection,
  pairing, deck rate) with a state and a remedy per missing step. It never
  changes Serato settings and never writes.
- `packages/serato/src/emulator.ts` (new): the scripted peer over a real TCP
  socket. Frames are built with serato-connect's own `osc`, `arg` and
  `frameOsc`; replies are split with its own `FrameReader`; the handshake walks
  Authorize, Pair and the subscription list. 14 action scripts cover the spec
  119 manipulations the Remote protocol can express.
- `packages/serato/vitest.config.ts`: workspace packages resolve to their
  sources (the same rule as `apps/desktop/vitest.config.ts`), so this package's
  tests exercise the code the app bundles instead of a package dist that may
  predate a sibling's current edits.
- `packages/serato/src/index.ts`: re-export lines appended only. Fixture
  writers stay out of the public surface on purpose (this package reads DJ
  data, never writes it, T-SEC-04).

## Proof

- `cd packages/serato && yarn vitest run`: 10 files, 75 tests passed. That
  includes the shared provider contract suite (T-LIVE-01) run against this
  provider with the emulator: start and stop idempotence, status transitions,
  generation on track change with no metadata leak, monotonic `receivedAtNs`,
  bounded queue, and a malformed frame that is counted and moves the provider
  to `degraded` instead of throwing into the manager. `runProviderContractSuite`
  returned `[]` (no failures).
- Four decks: `remote-provider.test.ts` loads a distinct track on decks 1 to 4
  through the socket and asserts each deck's own title, artist and
  `sourceIds.seratoPath`.
- Handshake: the emulator asserts a 16-byte digest in the Authorize response,
  `isActive=1` in the Pair reply, and the `/Register/Status/...` subscription
  list arriving.
- Field mapping: playhead, `playRate` 1.08, effective BPM 133.92,
  4-beat and 1-beat loops, loop roll (active, then cleared), upfader 0.8,
  crossfader 1.0 and a 30 s seek are asserted from emulator traffic.
- `yarn workspace @autolight/serato typecheck`: 0 diagnostics. This resolves
  the sibling contract through its package dist, so it was run after
  `yarn workspace @autolight/rekordbox-live build`; the phase-end
  `yarn build` produces the same dist from the current sources.
- `yarn workspace @autolight/serato build`: exit 0.

## Delete test

Delete the `noteTrackFieldsChanged` call in `applyStatusMessage` and the
replace-track test goes red on `loop.active` staying true and on the old track
title leaking into the new generation. Delete the playhead keep window and the
loopback capture test goes red, because the settled `deckChange` wipes the
playhead of the track that just loaded. Replace `ingestFrame`'s "apply all then
publish" order with a publish per message and the fixture expectations (one
state per burst) go red. Delete the `Valid === false` eject branch and the
eject test keeps the old file path in the next generation.

## Remaining seams (not claimed done)

- Main-process wiring: constructing `SeratoRemoteProvider` in the app's
  provider list and letting `live.provider` (or the DJ-software choice) select
  it belongs to the main-process slice. This package supplies the provider,
  `SERATO_REMOTE_PROVIDER_ID` and `seratoRemoteProviderFor(selection)`. Note
  `.dependency-cruiser.cjs` rule `ownership-library-single-owner`: only
  `electron/services/library-service.ts` and `identity-service.ts` may import
  `packages/serato`, so that wiring needs the rule extended for
  `services/provider-manager.ts`.
- `THIRD_PARTY_NOTICES` needs the `serato-connect` (MIT) entry; that file is
  outside this slice.
- HW-SER-01 is still pending, so discovery, handshake and deck updates are
  proven against the scripted peer and not against Serato DJ Pro itself.
- The status bar source badge already renders `SERATO` for `source: "serato"`
  (`apps/desktop/src/app/resolve-live.ts`); no change was needed here.

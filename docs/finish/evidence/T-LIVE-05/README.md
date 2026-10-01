# T-LIVE-05: PRO DJ LINK provider (`prolink`, DS-29)

Closes F-LIVE-04. Probe P-6-provider-contract (the provider is one of the four
subjects the shared suite runs against).

## What changed

- `packages/rekordbox-live/src/prolink.ts`: the decoder, written from the Deep
  Symmetry dysentery layout (no EPL code copied):
  - 10-byte magic (`Qspt1WmJOL`) validated first, then packet type and length
    per port, so a random 60-byte datagram, wrong magic, an unknown type and a
    wrong length are all rejected and counted.
  - Beat packets (port 50001, `0x60` bytes): next-beat interval in 1/100 ms at
    `0x24`, second-beat at `0x28`, pitch at `0x38` with `0x100000` as 0 percent,
    BPM times 100 at `0x5a`, beat within bar at `0x5c`, track device at `0x5e`.
  - Status packets (port 50002): track ID at `0x2c`, source slot at `0x28`, play
    state at `0x6f`, master and sync flags at `0x75`, pitch at `0x8c`, BPM at
    `0x92`, beat within bar at `0x94`.
  - Keepalives (port 50000, `0x36` bytes) for presence.
  - Golden vector builders so a regression moves bytes, not a test double.
- `packages/rekordbox-live/src/prolink-provider.ts`:
  - Peer registry with expiry (`live.prolink.peerExpiryMs`), DS-29 modes
    `passive`, `virtual-cdj` and `auto` (promote only while no real device uses
    `live.prolink.deviceNumber`), keepalives only in virtual-cdj mode and rate
    limited by `live.prolink.keepaliveMs`.
  - Status and beat packets map to deck state (track device, track ID, play
    state, master, sync, loop flag, pitch, BPM, beat counter). There is no
    absolute playhead in these packets, so `playheadSeconds` is estimated from
    the beat counter and labelled `estimated`.
  - Socket errors become provider status, never swallowed (S5).
- `protocol-fixtures/rekordbox/golden/prolink-vectors.json`: hand-built beat,
  status and keepalive packets with the documented raw offsets, plus the two
  rejection vectors (60-byte random, 96 bytes of zeros).
- Tests: `prolink.test.ts` decodes every vector, asserts the raw offsets, the
  rejection and count paths, pitch conversion, peer expiry, keepalive gating,
  auto promotion, and generation on track change. The contract suite runs the
  provider with real UDP loopback in `contract-suite.test.ts`.

Boundaries: `apps/desktop/electron/follow.ts` (the old parser this replaces) is
owned by another slice, so the app wiring is not in this commit. `HW-RB-PL-01`
settles whether the owner's setup emits PRO DJ LINK packets at all; if it does
not, the capability is `UNAVAILABLE_ON_THIS_DEVICE` with that reason, which is a
valid outcome.

## Proof

Observed with `node --experimental-strip-types` against the real modules:

- The committed beat vector decodes to `nextBeatMs` 500, `secondBeatMs` 250,
  pitch `0x100000`, BPM 128, beat within bar 1, and the raw words at `0x24`,
  `0x28`, `0x38`, `0x5a`, `0x5c` match the fixture's documented offsets. The
  status vector decodes track ID 1234567, slot 1, playing, master, sync, and
  flags `0x30` at `0x75`.
- A 60-byte random datagram and 96 zero bytes are both rejected, counted, and
  leave the provider without deck state.
- Peers expire after `live.prolink.peerExpiryMs`; auto mode demotes while a real
  device holds the configured number and promotes after expiry; keepalives are
  emitted only in virtual-cdj mode and only once per interval.
- The provider passes the shared contract suite (0 failures), including the real
  UDP loopback test.
- Scoped type check of the package: 0 diagnostics.

## Delete test

Delete the magic check in `decodeProlinkPacket` and the 60-byte rejection test
goes red (it decodes as a beat packet). Delete `expirePeers` and the peer expiry
test goes red. Delete the virtual-cdj gate in `shouldSendKeepalive` and the
keepalive gating test goes red because a passive provider would send.

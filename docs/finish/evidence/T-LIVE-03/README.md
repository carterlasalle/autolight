# T-LIVE-03: rkbx_link OSC provider (`rkbx-osc`)

Closes F-LIVE-03 (the consumer part). Probe P-6-provider-contract (the provider
is one of the four subjects the shared suite runs against).

## What changed

- `packages/rekordbox-live/src/osc.ts`: an OSC 1.0 codec written from the
  specification (4-byte big-endian arguments, NUL-terminated strings padded to
  4 bytes, `#bundle` with an 8-byte timetag and size-prefixed elements).
  Malformed datagrams are reported, never thrown.
- `packages/rekordbox-live/src/rkbx-osc.ts`:
  - Address mapping for `/<deck>/time`, `/bpm/current`, `/bpm/original`,
    `/track/title|artist|album|duration`, `/phrase/current|next|countin`,
    `/beat` and `/beat/subdiv/<x>`, with `master` or 1 to 4 as the deck token.
    Unknown addresses are kept under `raw` and counted.
  - Persistent loopback UDP listener on `live.rkbx.oscBind` (a datagram ingest
    path exists for tests and replay), socket errors reported as provider
    status, never swallowed (S5).
  - Playing inferred from time advancing
    (`live.rkbx.playingEpsilonMs`, `live.rkbx.pauseHoldMs`); a playhead jump the
    wall clock cannot explain emits a seek event (`runtime.seek.thresholdMs`).
  - Quality labels: `playheadSeconds` exact, `playing` and `beat` derived.
  - `/master/...` resolves to the numbered deck whose time matches, otherwise
    the master stays unassigned instead of being invented.
  - `parseRkbxOscConfig` and `checkRkbxSetup` are the verification half of the
    setup assistant: installed, OSC output enabled, destination matching, a
    Rekordbox version with community offsets, packets arriving. The assistant
    never re-signs Rekordbox, never uses sudo and never downloads rkbx_link.
  - `buildRkbxDatagrams` and `sendRkbxDatagrams` are the scripted deck timeline
    simulator (play, pause, seek, loop, pitch, track change, master change) at
    60 or 120 Hz over a real UDP socket.
- `protocol-fixtures/rekordbox/golden/osc-vectors.json`: hand-written OSC 1.0
  vectors (the specification example, a bundle, a truncated datagram).
- Tests: `osc.test.ts` (golden vectors, byte-exact round trip, malformed input)
  and `rkbx-osc.test.ts` (mapping, generation on track change, seek, pause,
  master, unknown retention, setup states, timeline replay at 120 Hz).

Boundaries: rkbx_link is a user-installed GPL-3.0 sidecar, never bundled, and
this package only consumes its OSC output. The setup assistant panel itself is
T-LIVE-04; the app imports `checkRkbxSetup` from here. The simulator module path
in the plan (`packages/simulator/src/rkbx-osc.ts`) is outside this slice, so the
datagram builder and sender live here and the simulator package can re-export
them. `HW-RB-RKBX-01` (owner decision gated) is the hardware capture that will
extend the fixture set; no hardware capture is claimed.

## Proof

Observed with `node --experimental-strip-types` against the real modules:

- Committed OSC vectors decode to the documented addresses and arguments, and
  the round-trip vectors re-encode byte for byte.
- A 120 Hz scripted timeline of 241 datagrams feeds the provider with the
  playhead tracking `/<deck>/time` within 20 ms
  (`runtime.estimator.maxErrorMs`), a seek event at the seek step, one
  generation bump at the track change and master resolved to deck 1.
- The provider passes the shared contract suite (0 failures) and reports
  malformed datagrams as rejected without throwing.
- Scoped type check of the package: 0 diagnostics.

## Delete test

Delete the `isRemaining`-style address mapping in `RkbxOscProvider.applyMessage`
and `rkbx-osc.test.ts` (mapping of time, BPM, track text, phrase) goes red.
Delete the seek comparison in `applyTime` and the seek test goes red. Delete
`checkRkbxSetup`'s unsupported-version step and the setup test that expects the
re-sign and sudo remedy goes red.

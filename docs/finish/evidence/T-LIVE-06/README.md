# T-LIVE-06: Accessibility provider (`ax`) on macOS and Windows

Closes F-LIVE-05, F-APP-10, F-QA-06 (the AX part). Probe P-6-provider-contract
(the provider is one of the four subjects the shared suite runs against).

## What changed

- `packages/rekordbox-live/src/ax.ts`: turns a dumped AX/UIA tree into per-deck
  readings.
  - Deck separation by the deck container (role plus the deck label), never by
    "the first two time strings".
  - Elapsed versus remaining decided by label text (`elapsed`, `remaining`, a
    leading `-` or `+`) and, when no label exists, by which value decreases
    across samples (`refineAxReading`). When both look the same the reading is
    not readable and no state is emitted for that deck.
  - `axFractionalBeat` maps elapsed seconds onto the ANLZ grid; `axBeatToPlayhead`
    now returns those fractional beats instead of a whole beat number.
  - `axPermissionState` states the macOS remedy; AX is never marked live without
    the permission.
- `packages/rekordbox-live/src/ax-provider.ts`: one poller's worth of state
  with in-flight coalescing enforced against `live.ax.intervalMs` (a poll that
  arrives early is dropped, never queued), `live.ax.timeoutMs` carried for the
  helper call the main-process poller owns, `estimated` playhead quality,
  `derived` playing quality, per-deck grids, `degraded` status naming how many
  decks are unreadable, `unavailable` with the remedy when the permission is
  missing, and a rejected count for trees with no deck containers. It never
  guesses a playhead from a deck it cannot read.
- `protocol-fixtures/rekordbox/ax/`: `macos-tree.json`, `windows-tree.json`
  (hand-shaped from the roles and labels Rekordbox exposes, with the note that
  they are not hardware captures) and `no-decks-tree.json` for the malformed
  path.
- Tests: `ax.test.ts` reads both OS trees, asserts deck separation, a paused deck
  reported paused, fractional beats from the grid, the unreadable-deck honesty
  path, the permission path, coalescing and the malformed tree.

Boundaries: the persistent helper process (JXA loop or a native addon) and the
deletion of the renderer poller are main-process work; this slice owns the
decoding and the provider contract it feeds. `HW-RB-AX-01` records the real
element trees on both OSes and replaces or extends the fixtures; no hardware
capture is claimed here. If Rekordbox's Windows UI does not expose the elements,
the capability is `UNAVAILABLE_ON_THIS_DEVICE` with the element dump as evidence.

## Proof

Observed with `node --experimental-strip-types` against the real modules:

- macOS fixture: decks 1 and 2, deck 1 reads `Nice For What`, elapsed 12 s,
  remaining -168 s, paused; deck 2 reads `Homecoming...`, elapsed 65 s, playing.
- Windows fixture: the same separation with `+0:12` and `-2:48` label hints.
- Fractional beats: elapsed 12 s against a grid anchored at 11.8 s and 12.2 s
  yields 1.5 beats from the provider, and 0.5 s against a 0/345/690 ms grid
  yields 2.449.
- A deck whose elapsed and remaining strings are equal emits nothing and leaves
  the provider `degraded`; a tree with no deck container is rejected and counted;
  a second poll inside `live.ax.intervalMs` is dropped.
- The provider passes the shared contract suite (0 failures).
- Scoped type check of the package: 0 diagnostics.

## Delete test

Delete the elapsed/remaining decision in `readAxDecks` (fall back to the first
time string) and the deck-1 assertions in `ax.test.ts` go red. Delete the
`readable` guard in `AxProvider.ingestTree` and the unreadable-deck test goes red
because the provider would emit a state for a deck it cannot read. Delete the
permission branch and the unavailable-with-remedy test goes red.

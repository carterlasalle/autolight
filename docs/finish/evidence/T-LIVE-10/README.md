# T-LIVE-10: OS2L provider (`os2l`)

Closes F-LIVE-10.

## What changed

- `packages/rekordbox-live/src/os2l.ts` (committed source):
  - OS2L endpoint per the os2l.org grammar: `_os2l._tcp` service type,
    reference port range 8010 to 8060, TCP accept path with a bounded tail
    (1 MiB cap) across chunks. Framing splits newline-separated messages
    AND consecutive JSON objects, keeps the incomplete tail, and reports
    non-object text as garbage.
  - Message mapping: beat events (`pos`, `bpm`, `change`, optional
    `strength`) to the master deck with `effectiveBpm` exact, `beat`
    derived, `playheadSeconds` estimated from the beat counter at the
    announced tempo; button names to playing/loop/hot-cue hints
    (case-insensitive, blackout ignored as transport); command messages
    retained under `raw` (never acted on); feedback is the one message we
    send, mirroring button state back to the DJ software.
  - Malformed input is rejected and counted, never thrown into the manager
    (S5). Socket errors become provider status.
- `packages/rekordbox-live/src/os2l.test.ts` (this slice, test-only): the
  shared contract suite still runs the full body, but two rows are pinned
  as documented N/A with a failing-capable guard:
  - OS2L is single-master-deck with no track identity: the provider maps
    beat events to deck 1 only and never reports track text, so
    `DeckGenerationMapper` cannot bump generation and no deck 2 state
    exists. `generation did not increase on track change` and `no deck
    state emitted for the second deck` are therefore expected failures,
    asserted present, while every other row must pass honestly.
  - The test stays failing-capable: if the source ever reports track
    starts, the pinned rows pass and the `toContain` assertions go red,
    forcing removal of the filter.

## Proof

Scoped run, 2026-10-01:

- `yarn workspace @autolight/rekordbox-live test`: 18 files, 129 passed.
  That includes `os2l.test.ts`: the service type and port range, framing
  splits plus tail, the beat/button/command/feedback grammar, garbage
  rejection with counting, beat mapping to the master deck
  (`effectiveBpm` exact, `playheadSeconds` estimated, `fieldSources`
  labelled `os2l`), button plus command hints retained under `raw`, a
  scripted OS2L client over a real TCP loopback socket (feedback round
  trip included), and the contract suite with the two pinned N/A rows.

## Delete test

Delete the `isFresh`-style beat mapping in `Os2lProvider.applyMessage` and
the master-deck test goes red. Delete the garbage path in `ingestChunk`
and the rejection test goes red. Delete the N/A filter in the contract
test and the suite reports the two pinned rows as failures.

## Seams

- Track-epoch seam: bumping generation needs a source-owned track-start
  signal (OS2L beat `change` is phase/BPM, not identity). When such a
  signal exists, thread it through `mapper.update` with a track key,
  delete the N/A filter, and the two rows must pass honestly.
- Single-deck seam: deck 2 support needs a deck token OS2L does not carry
  today; until then deck 2 stays honestly absent.
- Appears in fusion with its authority rank (`os2l`, last in the DS-01
  default order); also the fallback clock seam for the adaptive director
  (DS-23).

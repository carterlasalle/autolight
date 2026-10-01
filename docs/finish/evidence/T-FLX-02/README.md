# T-FLX-02: Full control map with deck separation

Closes F-FLX-02, F-FLX-03. Probe `P-11-flx4-map`
(`packages/controller-flx4/src/map.test.ts`).

## What changed

- `packages/controller-flx4/src/map.ts` (new) is the deck-aware map and
  decoder. Source: AlphaTheta / Pioneer "DDJ-FLX4 List of MIDI messages"
  (document E1, Ver 1.0, 2022), MIDI-IN columns, cited in the file header;
  the Mixxx community mapping was used as a facts-only cross-check.
  - Deck separation is the MIDI channel: deck 1 status `0x90`/`0xB0`, deck 2
    `0x91`/`0xB1`, mixer and effect rows `0xB6`/`0x96`/`0x94`/`0x95`/`0xB4`,
    pads `0x97` to `0x9A`.
  - `FLX4_CONTROLS` holds 397 rows: every deck control (PLAY, CUE, SHIFT, jog
    platter vinyl on/off/search/touch, tempo, BEAT SYNC press, long press and
    tempo range, LOOP IN/OUT, 4 BEAT/RELOOP/EXIT, loop halve/double, fader
    start, the eight pad-mode keys with their SHIFT layers), all eight pad
    modes across pads 1 to 8 in both pad layers (hot cue, pad FX1, beat jump,
    sampler, keyboard, pad FX2, beat loop, key shift), the mixer (master
    level, master cue, headphone mix and level, mic level, Smart CFX, Smart
    fader, Android mode, crossfader, and per deck trim, EQ high/mid/low, CFX,
    channel fader, headphone cue), the effect section (channel select, FX
    select, beat left/right, on/off, level/depth) and the browser (rotate,
    press, LOAD per deck).
  - 14-bit pairs are MSB then LSB CC numbers with the fixed +0x20 offset
    (`(msb << 7) | lsb` over 16383, normalized to 0 to 1). The decoder keeps
    the MSB per control, emits `complete: true` on the LSB that closes the
    pair and `complete: false` for a lone half, so a half is never invented
    into a full value and never dropped.
  - The jog is relative per the official list: `0x40` is centred, above
    `0x41` clockwise, below `0x3F` counterclockwise; the decoder emits the
    delta.
  - Every message maps to a typed `Flx4ControlEvent` (id, name, group, deck,
    kind, shift, pad mode and index, normalized value, on, complete, raw
    bytes, `receivedAtNs`). Unknown messages become counted `unknown` events
    with their raw bytes; malformed short arrays are counted the same way.
- The legacy `CC`/`NOTE` constants in `index.ts` now carry the official Data 1
  values (PLAY `0x0B`, CUE `0x0C`, SYNC `0x58`, tempo MSB `0x00`, channel
  fader `0x13`, crossfader `0x1F`, CFX `0x17`/`0x18`). They cannot express
  the channel, so both decks carry the same number there; the header comment
  points deck-aware callers at `decodeMessage` / `FLX4_CONTROLS`.

## Proof

- `packages/controller-flx4/src/map.test.ts`, 5 tests. The literal fixture in
  the test is an independent transcription of the official list's MIDI-IN
  columns per group:
  - `decodes every control of the capture with the right deck` walks all rows
    and asserts id, deck, shift, kind and pad index or mode, then asserts the
    decoder's unknown count is zero.
  - `covers the whole map: no control without a capture row` asserts the
    reverse direction, so a map entry added without a row reddens the test.
  - `keeps unknown messages as events with raw bytes and counts them`,
    `reconstructs 14-bit pairs monotonically across the full travel` (pairs
    covering tempo, channel faders, crossfader, trim, EQ, CFX, master level
    and FX level/depth, monotone and ending at 1), and `decodes the jog as a
    relative value around 0x40`.
- `docs/finish/evidence/T-FLX-02/red-run.txt`: the run with deck separation
  removed (`DECK_NOTE_STATUS` deck 2 forced to `0x90`, the old channel-blind
  behaviour). The first assertion shows `deck1.play 90:b` decoding as
  `deck2.play`, which is the collision F-FLX-02 describes.
- `docs/finish/evidence/T-FLX-02/green-run.txt`: 42 tests in 5 files passing
  and a scoped typecheck with zero diagnostics.
- The constant correction does not break the existing consumer:
  `yarn workspace @autolight/desktop vitest run src/app/services.test.ts`
  (17 tests) passes with the corrected values.

## Delete test

Restore the old numbers (0x14 channel fader 2, 0x10/0x11 tempo, 0x0A/0x0D
CUE, 0x0E/0x0F SYNC) and both the decoder test and the index legacy-constant
test go red. Remove the pad ranges from `PAD_MODE_BASE` and the coverage test
reddens. Treat a lone MSB as a complete value and the partial assertions in
the 14-bit sweep redden. Drop the unknown branch in `decode` and the unknown
counting test reddens.

## Seams

- The WP also names `packages/controller-flx4/docs/midi-map.md` and
  `tools/capture/flx4/record.ts` with `protocol-fixtures/flx4/<date>/*.ndjson`.
  Those paths are outside this slice's file ownership (a sibling or a later
  orchestrated step owns them), so the citation header and the table live in
  `src/map.ts` and the row-per-control capture lives in the test fixture. The
  committed rows are a transcription of the official document, not a hardware
  capture: a real capture from the owner's unit (HW-FLX-01 / HW-FLX-02) would
  replace them with recorded bytes and would also settle the two open
  questions the document leaves (which jog values the unit actually sends for
  slow moves, and whether any undocumented message exists).
- `flx4.tempoRange` `wide` and the Rekordbox tempo range setting are not
  visible in MIDI; only the provider fit in T-FLX-03 can recover them.

# T-SER-03: Serato file metadata, containers and GEOB tags

Closes F-SER-02, F-SER-03 (wp09-serato.md T-SER-03; spec 3.1; Holzhaus `serato-tags` docs, MIT, read-only).

## What changed

Sources untouched (SeratoM2 owns `packages/serato/src`; confirmed no body edits from either side). This slice adds `packages/serato/src/geob.test.ts` as golden/behavioral coverage over the existing parsers:

- BeatGrid golden from the documented example: header `01 00`, u32 count 1, terminal marker (position f32, BPM f32), footer byte. Asserts position and BPM decode.
- Live vectors: the existing ScratchBeat payloads (85 BPM at 0.046 s) still decode.
- Corrupt payloads (bad version, truncated header, truncated marker) throw loudly, never silently.
- `tempoRegionsToBeats`: single region at 120 BPM yields 4 anchors with beat 1 at +500 ms; the last region runs to 4 beats (60 BPM yields anchors through 3000 ms), not a truncated tail.
- Crate: synthetic `vrsn`/`otrk`/`ptrk` buffer parses to ordered paths; bad magic throws.

## Proof

- Same scoped run as T-SER-02: `yarn workspace @autolight/serato vitest run src/mapping.test.ts src/geob.test.ts src/serato-dod.test.ts`, 31 tests green this session.
- Golden provenance: header/marker/footer layout cross-checked against `serato-tags` docs (`docs/serato_beatgrid.md`), the `serato_beatgrid.py` reference parser (2-byte version `01 00`, u32 BE count, terminal f32 BPM vs non-terminal u32 beats-to-next, 1 footer byte), and the installed `serato-connect` type surface (`SeratoBeatgridMarker` with `bpm?` terminal vs `beatsToNext?` non-terminal, `SeratoMarkers2` with cues/loops/flips/color/bpmLock).

## Delete test

- Return a fixed 4-beat tail for the last region and the 60 BPM through-3000 ms assertion goes red.
- Swallow corrupt BeatGrid input (return `[]` instead of throw) and all three corrupt-payload assertions go red.
- Reorder crate paths and the ordered-paths assertion goes red.

## Seams / known gaps (future work, needs source edits by owner)

- The current `parseBeatGrid` reads every marker as (position f32, BPM f32) with a 1-byte count at offset 5. The documented format is version `01 00` (2 bytes), u32 BE count, non-terminal (position f32, beats-to-next u32), terminal (position f32, BPM f32), 1 footer byte. Multi-marker variable-tempo files will misdecode until SeratoM2 reworks the body; the single-marker goldens above still pass either way. Flagged to SeratoM2, not changed here per Main ruling.
- Full Markers2 (CUE/LOOP/COLOR/BPMLOCK/FLIP, unknown-kept-raw), Autotags, Overview, Analysis, and container readers (ID3v2/MP4/FLAC/Ogg, base64 wrap) are not implemented yet; `serato-connect` already ships `parseMarkers2`/`parseBeatgrid`/`parseAutotags` plus base64 variants, so the lazy path is to wrap those (spec 3.1 says use directly) rather than hand-roll parsers. T-SER-06 item 13 currently probes only the crate surface until that lands.

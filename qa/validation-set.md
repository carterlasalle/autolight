# Validation set (T-QA-09, spec 116, probe P-116-validation-set)

Audio is never committed; the manifest and the generated artifacts summaries are.

## Categories

house, tech-house, edm, bass-music, hip-hop, pop, rock, disco, fake-drops,
long-breakdowns, tempo-changes, weak-intros, irregular-structure.

Each category needs at least `qa.validation.minPerCategory` (3) tracks.
The owner picks the tracks (OD-10); the candidate list below is prepared from
the library analysis for the owner to confirm. Until confirmed every entry is
`status: candidate`.

## Candidates

| trackId | path | category | why |
| --- | --- | --- | --- |
| _TBD owner pick_ | _owner library_ | house | steady four on the floor, full phrase stack |
| _TBD owner pick_ | _owner library_ | tech-house | rolling bass, minimal breaks |
| _TBD owner pick_ | _owner library_ | edm | big-room builds and drops |
| _TBD owner pick_ | _owner library_ | bass-music | half-time sections, heavy sub |
| _TBD owner pick_ | _owner library_ | hip-hop | swung hats, sparse sections |
| _TBD owner pick_ | _owner library_ | pop | short form, clean choruses |
| _TBD owner pick_ | _owner library_ | rock | live drums, tempo drift |
| _TBD owner pick_ | _owner library_ | disco | orchestral hits, long intros |
| _TBD owner pick_ | _owner library_ | fake-drops | at least one silence fake and one vocal fake |
| _TBD owner pick_ | _owner library_ | long-breakdowns | breakdown over 32 beats |
| _TBD owner pick_ | _owner library_ | tempo-changes |GREATER than 5 BPM drift across the track |
| _TBD owner pick_ | _owner library_ | weak-intros | intro under -20 LUFS for 16 beats |
| _TBD owner pick_ | _owner library_ | irregular-structure | odd phrase lengths, missing chorus |

## Review tooling

For each track: render the show on the owner venue (or the reference room)
to a video with waveform, sections, events, and preview side by side, plus
the spec 115 diagnostics. `review-sheet.md` in this folder is the per-track
template covering the spec 116 aspects: structure, drop timing, restraint,
recurrence, contrast, colour coherence, spatial behaviour, transition
handling. The owner full review of every track happens in HW-REVIEW-01
under T-QA-13.

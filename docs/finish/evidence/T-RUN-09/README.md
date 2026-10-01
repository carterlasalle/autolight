# T-RUN-09: Adaptive director

Closes F-RUN-06; probe `P-71-adaptive` (spec 71, DS-28).

## What changed

- New `packages/show-director/src/index.ts`: the adaptive director for
  unanalyzed tracks. `buildLookLibrary` builds a deterministic library of at
  least `runtime.adaptive.minLooks` (default 24) coherent phrase-length looks
  from the planner primitive set (base section look, spatial motion, accents,
  at most one exclusive impact, bounded darkness fraction), parameterized by
  energy and palette, never by per-beat audio. `directorTick` holds one look
  per phrase (`runtime.adaptive.phraseBeats`, default 32) and picks the next
  look only when the phrase counter advances, with
  `runtime.adaptive.cooldownPhrases` cooldowns, no back-to-back repeats, no
  back-to-back strobes, and motif/palette variation. State is the full spec 71
  set: energy, phrase counter, motif history, palette, recent effects,
  cooldowns, darkness, spatial direction.
- DS-28: `rules` picks from the library ignoring audio and hints;
  `audio-informed` and `combined` (default) let live energy (T-AUD-02) and
  FLX4 expressive hints (T-FLX-05) nudge the desired energy at most one step.
  Onsets and hints never force a mid-phrase change; they only bias the next
  pick. Hints are consumed structurally through `DirectorHint`
  (fader-rise, filter-sweep, transport), so the director never imports the
  controller package and the spec 155 pipeline arrows stay clean.
- The old four-string `nextLook` in `packages/reactive-audio/src/index.ts` is
  superseded for new code but untouched: RunAudioM2 owns that file and the
  legacy `index.test.ts` expectations still pass against it.

## Proof

- `packages/show-director/src/index.test.ts` (`P-71-adaptive`): 256 beats with
  no TrackModel change looks only at beats 0, 32, 64, 96, 128, 160, 192, 224;
  no two consecutive phrase looks are identical; cooldowns are respected
  across the run; mid-phrase ticks return the same look with `changed: false`
  even at full energy with onset and hints; rules mode ignores audio while
  combined listens; the library holds 24 unique looks with bounded darkness;
  no strobe follows a strobe; spec 71 state is tracked on every pick.
- Scoped runs this session: `yarn workspace @autolight/show-director test`
  gives 1 file, 10 tests passed; the built bundle over 256 beats changes
  looks exactly at the 8 phrase edges with no repeats.
- Owner review video of 5 minutes of an unanalyzed track is not included:
  that is a human step for the owner at qualification time.

## Delete test

Pin the phrase counter to 0 and the 8-edge assertion goes red (one look for
256 beats). Remove the `l.id === last` filter and the no-repeat assertion goes
red. Return `seed % n` over four strings and the library-size, darkness-bound
and strobe-restraint assertions go red. Force a change on onset and the
mid-phrase hold assertion goes red.

## Seams

- `packages/show-host` does not call the director yet: wiring deck worlds
  without plans to `directorTick` on the adaptive clock belongs to the
  runtime owner (T-RUN-06/T-ARC-05), which also owns the beat source the
  `beat` input reads. This slice ships the pure director plus its contract.
- T-FLX-05 may add strength/duration fields to its hint; unknown fields and
  the `transport`/`filter-sweep` kinds are ignored by the pick, so that
  extension needs no change here.

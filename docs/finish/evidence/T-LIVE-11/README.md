# T-LIVE-11: Clean-room memory reader (`memory-cleanroom`)

Closes F-LIVE-03, F-SEC-03 (with T-SEC-05).

## What changed

- `packages/rekordbox-live/src/memory-reader.ts` (committed source):
  - Consent gate: the reader stays off unless `live.memoryReader.enabled`
    is true AND the T-SEC-05 consent flow granted access. Disabled reports
    `MISSING`, no consent reports `CONSENT_REQUIRED`, unknown version
    reports `UNAVAILABLE_ON_THIS_DEVICE` with `UNVERIFIED REKORDBOX
    VERSION`; only a qualified offsets file reaches `READY`.
  - Version discipline: every offsets file carries the Rekordbox version,
    platform, date and verification record (`parseOffsetsFile`,
    `lintOffsetsFile`, `qualifyOffsets`). An unknown version keeps the
    reader off, never probing blind.
  - Clean-room process: no rkbx_link code or offsets copied or consulted.
    The scanner (`scanMemoryOffsets`) finds values from known observations
    (a paused deck at a known time, known BPM), writes candidate paths and
    verifies across restarts, against a committed test target
    (`MapMemoryAccessor`) that mimics the structure with our own code.
  - Provider core: pointer-path walk over an injected memory accessor, so
    tests and the helper IPC transport share the decode. Deck state from
    samples with `playheadSeconds` exact, `playing` derived,
    `effectiveBpm` exact, `master` exact. Malformed helper frames rejected
    and counted, never thrown.
- No source or test change in this slice: the provider already passes the
  shared contract suite on helper poll.

Boundaries: the app itself never runs elevated; a separate signed helper
process owns the privileges and speaks to the main process over a local
socket. The helper process itself is host wiring outside this slice. The
re-sign requirement and its consequences are explained in the T-SEC-05
consent flow, never hidden.

## Proof

Scoped run, 2026-10-01:

- `yarn workspace @autolight/rekordbox-live test`: 18 files, 129 passed.
  That includes `memory-reader.test.ts`: offsets parse plus lint, unknown
  version stays off with `UNVERIFIED REKORDBOX VERSION`, the
  enable-plus-consent gate (disabled, no-consent, wrong-version,
  ready), deck state from the accessor (playhead 12.5 s, BPM 128, master,
  track `rb:555`, exact playhead quality, live status), candidate-path
  scanning from known observations, and the shared contract suite on
  helper poll (0 failures).

## Delete test

Delete the consent check in `capability()` and the consent-gate test goes
red (a no-consent reader reports READY). Delete the version check in
`qualifyOffsets` and the unknown-version test goes red. Delete the
generation bump path (stop passing the sampled track id through the
mapper) and the contract-suite test goes red on the no-leak row.

## Seams

- `HW-RB-MEM-01` (owner decision gated) produces the offsets file for the
  owner's version plus a replay fixture from real use; no hardware capture
  is claimed here.
- Token-source seam for T-LIVE-08: the memory reader is one enumerated
  agent-API token source (consent required), alongside file and manual.
- Emits `ProviderDeckState` with `fieldSources`/`quality`, so fusion
  (T-LIVE-02) ranks it with no downstream branching.

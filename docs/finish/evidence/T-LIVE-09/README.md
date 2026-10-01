# T-LIVE-09: Lighting IPC provider: capture tooling, fixtures, decoder, replay

Closes F-LIVE-01, F-LIVE-02, F-LIVE-15 (the tooling, container codec and
replay half). Probes P-8-lighting-provider, P-9.2-surface-inventory,
P-9.3-matrix-complete, P-9.4-capture-nonempty, P-9.5-decoder-fields,
P-128-replay-decodes.

## What changed

- `packages/rekordbox-live/src/lighting-ipc.ts` (committed source):
  - Capture container codec: length-prefixed framed JSON events
    (`encodeLightingCapture`, `decodeLightingCapture`, base64 forms). This
    is our documented capture container, not a guess at SoundSwitch bytes.
    Unknown JSON fields are retained under `raw`, never dropped (spec 9.5).
    Truncated frames, oversized frames and empty captures decode to
    `malformed` entries, never throw.
  - Capture matrix (spec 9.3): `LIGHTING_MATRIX_ACTIONS` (27 actions) times
    `LIGHTING_MATRIX_CONDITIONS` (7 conditions), 189 cells via
    `lightingMatrixCells()`, with `lightingFixturePath()` giving the spec
    9.4 fixture path per cell.
  - Surface inventory (spec 9.2): `LIGHTING_SURFACES` (10 surfaces: tcp,
    udp, mdns, unix-sockets, websockets, localhost-http, ipc-pipes,
    file-descriptors, rekordbox-logs, soundswitch-logs) plus
    `validateSurfaceInventory()` requiring every surface before a capture
    counts.
  - Fixture envelope (spec 9.4): `parseLightingFixture` requires
    `rekordboxVersion`, `platform`, `action`, `condition`, non-empty
    `capture`, `decoder`, `expectedBy`; `lintLightingFixture` rejects empty
    captures, synthetic markers and decoder-named authors (P-9.4).
  - Replay (spec 128, T-QA-03 semantics): `replayLightingCapture` runs raw
    capture bytes through the real decoder at 1x, 2x, 10x and step.
  - `LightingIpcProvider` selectable under DS-01: `capability()` is
    `MISSING` with the owner remedy until real captures land, `READY` once
    fixtures exist. `ingestEvent` and `ingestBytes` run the same
    bytes-to-state path as fixture replay.

Boundaries: no SoundSwitch protocol is claimed and no decoder is guessed
before real captures exist (S2). The owner tooling scripts
(`tools/capture/rekordbox/`) and the `HW-RB-LIGHT-01` runbook are owner
gating: installing Rekordbox 7.2.19+ and a SoundSwitch plan or trial is an
owner decision, so this task records the tooling plus the honest MISSING
capability. The three hand-written 7.2.10 fixtures under
`protocol-fixtures/rekordbox/7.2.10/macos/` carry the
`handwritten-synthetic` capture marker the lint rejects, which is the
honest name the spec asks for.

## Proof

Scoped run, 2026-10-01:

- `yarn workspace @autolight/rekordbox-live test`: 18 files, 129 passed.
  That includes `lighting-ipc.test.ts`: framed round trip through the real
  decoder, unknown-field retention plus truncated-frame rejection (P-9.5),
  empty-capture lint rejection (P-9.4), replay at 1x, 2x, 10x (P-128),
  master/loop/pitch/sync/hotcue/roll mapping, the 27 by 7 matrix plus the
  spec 9.2 surface list, MISSING with the owner remedy, and the shared
  contract suite on event ingest (0 failures).
- `soundswitch-absent.test.ts` proves spec 120 item 15: fusion of rkbx-osc,
  prolink, ax, os2l, memory-cleanroom and composite-flx4 with no Lighting
  provider, and the Lighting provider MISSING while every other provider
  goes live.

## Delete test

Delete the `malformed` push for truncated frames in `decodeLightingCapture`
and the P-9.5 test goes red (truncated bytes decode silently). Delete the
empty-capture guard in `lintLightingFixture` and the P-9.4 test goes red.
Delete the generation bump path in `frameToState` (stop passing track
identity through the mapper) and the contract-suite test goes red on the
no-leak row.

## Seams

- Consumes no transport yet: when `HW-RB-LIGHT-01` lands real captures, a
  SoundSwitch-specific decoder plugs into `decodeFrames` behind a versioned
  decoder id and the same replay path validates it.
- Registered in the version registry (`lighting-container/v1`, T-LIVE-13);
  a new fixture set flips a version to qualified only when replay passes.
- Emits `ProviderDeckState` with `fieldSources`/`quality`, so fusion
  (T-LIVE-02) ranks it with no downstream branching.

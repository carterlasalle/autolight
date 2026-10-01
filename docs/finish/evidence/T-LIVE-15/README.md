# T-LIVE-15: Version and dependency decision packet for the owner

Closes F-LIVE-15, F-LIVE-16.

## What changed

- No new source in this slice: the packet is assembled from committed
  facts, and the panel renders from the registry, not hardcoded text.
- Version matrix (from `setup-assistant.ts`, `version-registry.ts` seed):
  - rkbx_link on macOS (Apple Silicon): community offsets cover 7.2.8,
    7.2.17, 7.2.18. The installed 7.2.10 is NOT covered on macOS.
  - rkbx_link on Windows: 7.2.10 covered through a paid rkbx_link
    license.
  - Lighting (SoundSwitch): needs Rekordbox 7.2.19+ and SoundSwitch
    2.11+ with a Creative/Professional plan or trial (spec 9.1,
    F-LIVE-15). The installed 7.2.10 does not qualify.
  - Everything else (PRO DJ LINK, AX, OS2L, memory reader, composite
    FLX4, Ableton Link sidecar) has no such version gate; each reports
    its own capability honestly when its transport is absent.
- Cost and consequence notes (from the assistant copy and the provider
  statuses, not new claims): rkbx_link macOS setup re-signs Rekordbox
  with the `get-task-allow` entitlement (removes notarization, security
  warning on launch) and runs the reader with `sudo`; SoundSwitch needs a
  paid plan or trial; the memory reader needs the T-SEC-05 consent flow.
  The assistant never re-signs, never uses sudo, never downloads the
  sidecar.
- Measured accuracy from SIM (committed tests, no hardware claimed):
  rkbx-osc playhead tracks its scripted timeline within 20 ms at 120 Hz;
  composite playhead error after lock is below
  `live.composite.lockedErrorMs` (15 ms); AX playhead is `estimated`
  (about one beat); OS2L playhead is `estimated` from the beat counter;
  fusion raises a diagnostic past `live.fusion.disagreeBeats` (0.25).
- Spec 120 item 15 is proved by `soundswitch-absent.test.ts`: the full
  non-Lighting set fuses with SoundSwitch absent, and the Lighting
  provider reports MISSING with the owner remedy.

Boundaries: the owner chooses; the app never acts on these choices
itself. Until the owner runs the captures, the Lighting capability stays
`MISSING` in `capabilities.yaml`, T-LIVE-09 stays owner-gated on
`HW-RB-LIGHT-01`, the memory offsets stay ungenerated on `HW-RB-MEM-01`,
and no hardware capture is claimed anywhere in this packet.

## Proof

Scoped run, 2026-10-01:

- `yarn workspace @autolight/rekordbox-live test`: 18 files, 129 passed,
  including `setup-assistant.test.ts` (10 tests: version table, build-tag
  prefix match, receiving walk, unsupported-version remedy),
  `soundswitch-absent.test.ts` (fusion without Lighting, MISSING with
  remedy), and `version-registry.test.ts` (qualified/unverified/
  unsupported per provider, banner without modal).
- The Settings "Rekordbox live sources" panel renders this matrix from
  the registry (`seedRegistry` plus `registryStatus`): no hardcoded
  version text beyond the registry entries themselves.

## Delete test

Delete the macOS version table in `setup-assistant.ts` and the
`UNAVAILABLE_ON_THIS_DEVICE` test for 7.2.10 on macOS goes red. Delete
the MISSING branch in `LightingIpcProvider.capability` and the
SoundSwitch-absent test goes red. Hardcode the panel matrix instead of
reading the registry and the registry round-trip plus status tests stop
covering what the panel shows (the panel test fails on a registry
change).

## Seams

- Decision inputs: `seedRegistry` (per-provider version ranges),
  `RKBX_MACOS_VERSIONS` / `RKBX_WINDOWS_VERSIONS` (rkbx_link coverage),
  `checkRkbxSetup` (packet-arrival verification), provider `capability()`
  reports (MISSING / UNAVAILABLE_ON_THIS_DEVICE with remedy).
- Owner runbooks gated by this packet: `HW-RB-LIGHT-01`, `HW-RB-RKBX-01`,
  `HW-RB-PL-01`, `HW-RB-AX-01`, `HW-RB-COMP-01`, `HW-RB-MEM-01`,
  `HW-RB-LINK-01`, `HW-RB-AGENT-01`.

# ADR-001: Rekordbox live-follow without SoundSwitch

Date: 2026-09-30. Status: scoped, not built.

## Context

Provider #1 (Lighting IPC / SoundSwitch) is dark: user runs Rekordbox
7.2.10 without SoundSwitch, so no transport surface exists. The app
resolves the loaded track's ANLZ grid + plan (Homecoming @ 173.98 proven)
but cannot follow the playhead. No FLX4 board is available or required —
MIDI is secondary truth only (§11). User asked for both options scoped as
a setting, plus prior-art research.

## Prior art (verified 2026-09-30)

- Deep Symmetry `dysentery` packet analysis (`djl-analysis/`): beat packets
  (60B, port 50001, per-beat from master player), CDJ status packets
  (subtype 0x03, ~200ms, play state + beat-in-bar + pitch + loops), absolute
  position packets (CDJ-3000, 30Hz). Rekordbox sends **mixer-style** status
  (name "rekordbox", D=0x11, F=c0 always-playing, BPM tracks master, Bb=0)
  — position must come from beat packets of a link peer, not from Rekordbox
  itself.
- `beat-link` (EPL-2.0, JVM): VirtualCdj + metadata queries. `beat-link-trigger`
  (EPL-2.0): lighting/video/DAW triggers from the same feed — closest prior
  product to this task. `open-beat-control` (EPL-2.0): OSC bridge subset.
- `fiverecords/supertimecodeconverter` (MIT): Virtual CDJ → SMPTE timecode,
  absolute position on CDJ-3000, beat-derived on NXS2-, ANLZ PQTZ
  micro-correction via PLL. Cleanest reference implementation.
- `chdxd1/node-tcnet` (MIT): TCNet (ShowKontrol/EIG/Pioneer) — needs Bridge
  software, untested on real gear.
- Wolfmix forum (2025-03): Rekordbox sends **no MIDI Clock**; answers are
  Ableton Link (synced sets), external DJM mixer clock (open format), or
  BeatKontrol/ShowKontrol (macOS, Pro DJ Link → Ableton Link).
- License rule (§112): EPL/GPL concepts study-only in proprietary core;
  MIT (supertimecodeconverter, node-tcnet) reusable with attribution.

## Decision

Ship a `followMode` setting (Setup tab): `preview` | `ax-beat` |
`prolink` | `soundswitch`. Default `preview`. Mode only widens the
playhead source; planner/renderer/mixer unchanged.

- **preview (now):** committed ANLZ fixtures → grid + plan + venue preview.
  No sync, no Govee until discovery. Works alongside Macro/RB-DMX1.
- **ax-beat (slice 1):** main-process AX poll (~1Hz) of deck elapsed fields
  → `secondsToBeat` via PQTZ grid → cursor. Accuracy ±1 beat; pauses/seeks
  snap via existing `isSeek`. Falls back to preview when AX unreadable.
- **prolink (slice 2):** Node Virtual-CDJ: keep-alive → 50000, beat capture
  on 50001, status queries on 50002, per dysentery analysis + MIT
  supertimecodeconverter patterns. Beat-accurate when a link peer emits;
  Rekordbox-alone yields master BPM only. Needs link peer on LAN.
- **soundswitch (gated):** Lighting IPC capture matrix (§9) when 7.2.19+ +
  2.11+ installed. Sample-accurate. Remains Provider #1.

## Consequences

- No board required in any mode; no SoundSwitch dependency at runtime.
- AX poll and Virtual-CDJ are estimation, stated as such in UI copy.
- EPL code never lands in core; MIT reuse keeps attribution.
- Follow-up: build ax-beat slice, then prolink slice, each with replay
  fixtures + track-sync matrix entries.

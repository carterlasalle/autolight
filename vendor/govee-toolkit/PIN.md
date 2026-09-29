# Pinned vendor fork: damient/govee-toolkit (§44-45)

- Upstream: https://github.com/damient/govee-toolkit
- Pinned revision: ceef296f6382881c5f07698d78fb5719ebca6686 (node 0.5.0 / rust 0.14.0)
- License: MIT (Copyright (c) 2026 Damien Thery)
- Relevant surfaces: `SegmentStream.set_all(Uint8Array)` (newest-state-wins,
  `frames_superseded()` counter), razer arm `B1` + RGB stream `B0` frames
  (`devices/families/lan-razer.yaml`), per-device YAML profiles (`devices/`).

## Why a fork is required (§45)

Upstream's verified device table has no H6076/H1A45 profiles. Our fork adds
`devices/H6076.yaml` + `devices/H1A45.yaml` (measured segment counts, order,
arm settle, stable FPS, latency) once hardware qualification (§52) measures
them — never assumed from SKU.

## Transport seam

`@autolight/govee` owns `SegmentStream` + `ToolkitStreamFactory`. The fork's
Node binding (`packages/node`: `SegmentStream.setAll(Uint8Array)`,
`frames_superseded()`) implements the factory. `LatestStream` is the
no-hardware fallback with identical coalescing semantics. Cloud is never a
live renderer (§148).

## Status

Pinned + seam defined. Live binding wires up when hardware is on the LAN
(blocked 2026-09-29: scan found no Govee devices).

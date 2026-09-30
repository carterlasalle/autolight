# T-OPS-01: Environment facts (owner machine)

Recorded 2026-09-30. Every measured fact names the command that produced
it. Anything not measured on this machine is marked owner-to-confirm and
no version is invented.

## Owner Mac (measured)

Source: `sw_vers` and `system_profiler SPHardwareDataType` run on this
machine on 2026-09-30.

- Model Name: MacBook Pro
- Model Identifier: MacBookPro18,3
- Model Number: Z15G001WCLL/A
- Chip: Apple M1 Pro (10 cores: 8 performance, 2 efficiency)
- CPU string (`sysctl -n machdep.cpu.brand_string`): Apple M1 Pro
- Logical CPUs (`sysctl -n hw.ncpu`): 10
- Memory (`system_profiler` / `sysctl -n hw.memsize`): 16 GB (17179869184 bytes)
- macOS (`sw_vers`): macOS 26.5.1, build 25F80
- Architecture (`uname -m`): arm64

## Toolchain (measured on this machine)

- Node (`node --version`): v22.22.2
- Yarn (`yarn --version`): 4.9.2
- Python (`python3 --version`): Python 3.14.7
- FFmpeg (`ffmpeg -version | head -1`): ffmpeg version 9.0.1
- Electron (declared in `apps/desktop/package.json`, not a runtime read): ^41.10.6

## DJ software (measured via bundle plists)

`mdls` returned null for these bundles, so versions were read with
`plutil -p <bundle>/Contents/Info.plist` on 2026-09-30.

- Rekordbox (`/Applications/rekordbox 7/rekordbox.app`,
  `com.pioneerdj.rekordboxdj`): 7.2.10.0333
- Serato DJ Pro (`/Applications/Serato DJ Pro.app`,
  `com.serato.seratodj`): 3.3.5 (build 3.3.5.29)
- Also installed: Serato DJ Lite (`/Applications/Serato DJ Lite.app`,
  version not read), Pioneer FwUpdateManager (`/Applications/Pioneer`,
  version not read)

## Network (measured)

- Default route (`route -n get default`): gateway 10.24.0.1 via en0
- Wi-Fi (`networksetup -getairportnetwork en0`): not associated with an
  AirPort network on 2026-09-30 (wired or disconnected at record time)
- Router model, band, AP isolation and multicast settings: owner-to-confirm

## Owner-to-confirm (never measured here, never invented)

- DDJ-FLX4 firmware version
- Govee units: SKU, hardware version and firmware version for each unit
- Windows reference machine: model, OS build, installed DJ software
  versions, and whether it is set up or planned
- Network: router make/model, band (2.4 vs 5 GHz), client/AP isolation
  and IGMP or multicast snooping settings used for hardware runs

## Diagnostics panel agreement

The app Diagnostics Environment panel
(`apps/desktop/src/renderer/components/environment-panel.tsx`) renders
Electron, Node, Chrome, OS and CPU facts passed in as props from the
main process at runtime. Static owner facts above (DJ app versions,
firmware, Govee units, network intent) are transcribed into that panel
or its backing config by the integrator; this document is the source of
truth until then.

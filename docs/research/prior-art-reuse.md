# Prior art and reuse map

Date: 2026-09-30. Status: research only, no code changed.
Scope: every link and repo named in the kickoff notes (Govee LAN guide, Govee
community posts, reddit thread, SignalRGB docs, `govee-lan-control`, the
`govee-api` GitHub topic, `wez/govee2mqtt`, `lasswellt/govee-homeassistant`,
`runtalan/lightwave`, `grufkork/rkbx_link`, `fjel/rkbx_os2l`) plus
`govee-toolkit`, which the repo already pins.

Reading depth is stated per source so nothing here is claimed beyond what was
read. Rule from SPEC section 112 applies throughout: MIT code may be reused with
attribution, GPL code is study only or a separate process, unlicensed code is
study only.

## 1. Verdict table

| Source | License | Read | Verdict |
| --- | --- | --- | --- |
| govee-toolkit (npm `govee-toolkit@0.5.0`) | MIT | Docs, device YAML, stream/rate/sender source, Node binding types | Reuse directly as the LAN transport core |
| wez/govee2mqtt | MIT | `lan_api.rs` in full, `docs/LAN.md`, SKUS, FAQ | Copy the discovery ladder and reply handling into TypeScript |
| runtalan/lightwave | MIT | DISCOVERY, DELIVERY, ARCHITECTURE | Copy the failure-handling and release-gate discipline |
| lasswellt/govee-homeassistant | MIT (copyright LaggAt) | ARCHITECTURE, protocol reference (grepped) | Copy transport health, verified writes, rescan cadence |
| grufkork/rkbx_link | GPL-3.0 | README, MACOS_SETUP, resign script, offsets, beatkeeper, memory module | Separate-process sidecar only. Never copy or link |
| fjel/rkbx_os2l | No license file (all rights reserved by default) | README, Cargo.toml, file layout | Study only. Windows only |
| Govee official WLAN guide | Vendor doc | Full page via browser | Authoritative for the 5 documented messages and the SKU list |
| SignalRGB Govee page | Doc | Full | Use for the network troubleshooting checklist |
| PyPI `govee-lan-control` | MIT | Summary | Nothing to take. Single device (H6056), no segments |
| GitHub `govee-api` topic | n/a | Listing | Nothing beyond the repos above |
| Govee community posts 135660 and 136755 | Login gated | Stub text only | 2023 basics, duplicated by the official guide |
| Reddit thread 1m3ittg | n/a | Not reachable (site blocked for this tool) | Unread. The razer channel it likely describes is documented in the toolkit instead |
| matter.js example | n/a | Not read | Deferred. Matter is on/off/level/color, not a frame path |

## 2. What the sources agree on (Govee LAN)

- Official messages are exactly five: `scan`, `turn`, `brightness` (1-100),
  `devStatus`, `colorwc` (kelvin 0 means pure RGB). Scan goes to multicast
  `239.255.255.250:4001`, replies arrive on `4002`, control goes to device `4003`.
- Both target lights are on the official LAN list: H6076 ("Govee Floor Lamp
  H6076A") and H1A45 ("Govee LED Strip Light 2"). Each device needs its LAN
  switch enabled in the Govee Home app.
- Multicast is unreliable on Wi-Fi routers. Every mature project adds broadcast
  and unicast fallbacks. Guest networks and AP/client isolation block it.
- Only one program can hold UDP 4002 at a time. Homebridge-govee, Govee LAN
  Control, SignalRGB or another controller will conflict.
- `devStatus` returns four fields only (`onOff`, `brightness`, `color`,
  `colorTemInKelvin`). It is not ground truth for segments or scenes.

## 3. What to take, by source

### 3.1 govee-toolkit (MIT, Damien Thery, v0.5.0)

Take as a dependency: `yarn add govee-toolkit`. The Node addon ships prebuilt
binaries (darwin-arm64 and win32 among them). Electron must load it from
outside the asar (`asarUnpack`).

Take as knowledge, and encode as our own tests:

- Razer frame: JSON envelope `{"msg":{"cmd":"razer","data":{"pt":"<base64>"}}}`.
  Frame is `BB <len16 payload only> <op> <payload> <XOR of all preceding bytes
  including BB>`. B1 arms, B0 paints `[gradient, nbSeg, RGB x n]`, B4 is the
  zoned variant, B2 is the armed state in the `status` reply.
- Sequence: `turn(1)`, arm, wait about 50 ms, then stream. A paint sent right
  after arming is dropped silently.
- Traps: `turn` or a white `colorwc` while armed ends the channel
  (`brightness` is safe). Three back-to-back commands drop the third. Nothing
  acknowledges a frame. A unit may not answer `status` while armed, so do not
  verify commands during a stream.
- Rate ceilings measured on hardware: 40 Hz at 20 zones, 25 Hz at 60,
  20 Hz at 120. Unmeasured units fall back to 10 Hz. Brightness is global.
- Newest frame wins: a fixed-interval emitter holds current colors, skips
  unchanged ticks, uses `MissedTickBehavior::Delay` (never burst to catch up),
  and counts `framesSuperseded`. Disarm is sent by the emitter task on close.
- Per-SKU facts live in data (`devices/<SKU>.yaml`: capabilities, `arm_settle`,
  `frame_rate` by zone count, `native_pixels`, `segment_chain`). Only H61A0 is
  verified. H6076 and H1A45 are unverified for razer, so capability must be
  probed at runtime with a `colorwc` fallback.
- `identify_walk`: light one device at a time to map names to physical units.
  Worth copying as our Identify flow (today it only sends `turn`).
- Bonus: a `govee-dmx` bridge accepts Art-Net and drives devices. Not needed
  now, but it is a ready path if a lighting desk ever feeds AutoLight.
- Stance to respect: the toolkit never fails over between modes silently. Mode
  is an explicit list per device.

Risk: new project, single author, one verified SKU. Keep our
`ToolkitStreamFactory` seam and also keep a small TypeScript razer encoder that
is tested against the toolkit's frames as golden vectors. That gives a test
double and an escape hatch.

### 3.2 govee2mqtt (MIT, Wez Furlong)

From `src/lan_api.rs` and `docs/LAN.md`:

- Discovery ladder, each step optional and configurable: multicast, per-
  interface directed broadcast (enumerate interfaces, skip loopback), global
  `255.255.255.255`, explicit scan list of IPs or hostnames.
- Retry: resend the scan every 2 s, doubling to a 60 s cap. Never stop.
- One listener on 4002 for the whole process. Route replies to waiting callers
  by sender IP, so one socket serves scan, `devStatus` and everything else.
- Some newer devices omit `ip` in the scan reply. Default it to the sender
  address (their issue 437) and warn if the two disagree.
- `devStatus` read-back: resend every 350 ms for up to 10 s until a reply.
- Clear error when 4002 is already bound, naming the likely culprits.
- Optional `ptReal` over LAN carries base64 BLE-format packets, which is how it
  sets scenes locally. Useful later for scene fallbacks, not for frames.
- Do not copy: it binds a fresh UDP socket per command. We use one persistent
  socket.

### 3.3 lightwave (MIT, Renato Untalan)

- Discovery repair lessons: never bind once and silently give up. Retry the
  listener on each scan, report port conflicts instead of taking over, join the
  multicast group on every eligible interface, rescan in the background every
  15 s, validate the sender address and device identity, keep LAN IDs and BLE
  IDs distinct with no auto-merge, and never let a missing target fall through
  to "all lights".
- Command engine: separate requested state from observed state, per-device
  queues with coalescing, generation counters so obsolete retries cannot
  override newer input, power-off cancels queued effects. Starting hypothesis of
  5 light-changing packets per device per second for non-stream commands (their
  own hypothesis, not a Govee limit). Poll visible devices every 2 s, others
  every 10 s, stale after 15 s.
- Release gates worth adopting verbatim: fake UDP devices for loss, duplicates,
  late replies and IP changes; a network matrix (blocked multicast, guest
  isolation, VPN, firewall denial, port conflict, router restart); a published
  tested-device table; do not promote a model family from a shared prefix; do
  not publish latency numbers that were not measured.
- Correction: Lightwave does not implement BLE control (discovery only).

### 3.4 govee-homeassistant (MIT, Florian Lagg copyright)

- Per-device, per-transport health tracking (`transport_health.py`), surfaced
  in diagnostics with redaction of IDs and addresses.
- LAN writes verified by reading the device back. Fastest-transport routing for
  control, with an optimistic state update.
- Periodic LAN rescan every 300 s, explicit `device_id=ip` overrides for other
  VLANs.
- Segment writes are paced, and a segment color overlay is replayed after a
  whole-device write. Scene cache with TTL.
- Warns that the 4-field `devStatus` schema is not ground truth for segments.

## 4. Rekordbox live data

### 4.1 rkbx_link (GPL-3.0, grufkork)

What it does: reads Rekordbox process memory at 60 to 120 Hz for sample
position (int64 at 44.1 kHz), BPM (float), master deck index, track info and
the ANLZ `.DAT` path per deck, then parses the beatgrid with `rekordcrate` and
emits Ableton Link, OSC, sACN, track and setlist files. Per-version pointer
chains live in a data file (`data/offsets`, `data/offsets-macos`).

Outputs relevant to AutoLight (OSC, default `127.0.0.1:4450` to `4460`):
`/[deck]/time` (seconds), `/[deck]/bpm/current`, `/[deck]/bpm/original`,
`/[deck]/track/title|artist|album`, `/[deck]/phrase/current|next|countin`,
`/[deck]/beat/subdiv/x`, where `[deck]` is `master` or 1 to 4. Ableton Link and
sACN carry the master deck only, so OSC is the useful channel.

Version coverage (this changes an earlier note):

- macOS community offsets: 7.2.18, 7.2.17, 7.2.8, Apple Silicon only.
- Windows offsets with a paid license: 7.2.18 down to 7.2.2, including 7.2.10.
- The installed Rekordbox here is 7.2.10.0333, so neither macOS nor an
  unlicensed Windows setup covers it. A Rekordbox update to 7.2.17 or 7.2.18 is
  required for the macOS path.

macOS setup cost: Rekordbox must be re-signed with the `get-task-allow`
entitlement (script provided), which removes Apple notarization, produces a
security warning on first launch, and the reader runs with `sudo`. An
application update will likely replace the signature (inference, not stated by
the project). This is a real risk on a performance laptop.

License handling: GPL-3.0 means no copying code or offsets into AutoLight and
no linking. Run it as a separate user-installed process and read its OSC over
UDP. Do not bundle its binary in our installer without meeting GPL obligations
for that binary. Not legal advice.

What to learn from it without copying: the design (memory reader with keep-warm
decks, slow-update cadence for text fields, delay compensation in
milliseconds), and that sample position plus BPM plus the ANLZ grid is enough to
derive beat position. We already parse PQTZ, so the missing piece is only the
live time source.

### 4.2 rkbx_os2l (no license, fjel)

Windows only, two decks, master only, supports 7.2.8, 6.8.5 and 6.8.4. Reads
memory like rkbx_link, resolves track paths through Rekordbox's local database
agent using a bearer token that is read from memory and resets on every start,
and speaks os2l to SoundSwitch. No license file means all rights reserved.
Study only, and not applicable to the current platform.

### 4.3 Options for a live playhead on Rekordbox (decision needed)

| Option | Needs | Accuracy | Cost or risk |
| --- | --- | --- | --- |
| A. rkbx_link sidecar over OSC | Update Rekordbox to 7.2.17 or 7.2.18, re-sign, sudo, Apple Silicon | Sample accurate, both decks via OSC | Breaks notarization, breaks on Rekordbox updates until offsets land, GPL sidecar |
| B. Lighting IPC | Rekordbox 7.2.19+ and SoundSwitch 2.11+ | Sample accurate | Extra software, needs an update and a capture matrix |
| C. Current AX poll plus ProLink | Nothing extra | About 1 beat | Already in repo, ProLink parser is wrong (see section 6) |
| D. Own memory reader | Own pointer scans per version | Sample accurate | Ongoing reverse engineering, fragile, more legal exposure |

Recommendation: keep C as the fallback, implement A as an opt-in "advanced"
provider behind the existing `LiveProvider` interface (OSC in, no sidecar code
in our tree), and let the user choose A or B when they pick a Rekordbox version.

## 5. Mapping to the audited gaps, in a revised fix order

1. Transport correctness (MIT reuse, highest value per hour).
   Add `govee-toolkit` behind `ToolkitStreamFactory`. Replace the per-packet
   `execFile("node", ...)` in `show-service.ts` with one persistent socket owned
   by the main process. Fix `encodeFrame` (16-bit length, XOR includes 0xBB) and
   add the JSON and base64 envelope. Delete the three-command `frameToLan` path.
   Add arm, settle, probe (B2 status), rate cap by zone count, disarm on close.
   Probe H6076 and H1A45 at runtime with a `colorwc` fallback. Wire
   `pushFrame` and a real Identify walk.
2. Discovery. Ladder plus 2 s to 60 s backoff, one 4002 listener, sender-IP
   routing, MAC-keyed on-disk cache, background rescan, explicit port-conflict
   message, network troubleshooting page from the SignalRGB checklist.
3. Health and honesty. Per-transport health, requested versus observed state,
   qualification results persisted per hardware ID, SKU and firmware, and the
   tested-device table. Remove claims that no test backs.
4. Live follow. Fix the ProLink parser, then add the OSC provider (option A)
   once the user picks a Rekordbox version. Feed both decks and stop hardcoding
   `playing: true`.
5. Show logic defects from the audit (audible weighting, blackout target ALL,
   renderer hue, planner ignoring intensity settings, Serato beatgrid parsing,
   analysis worker error handling). These are independent of transport work.

When defects are fixed, the repo's `bug-corpus` skill applies to each confirmed
bug.

## 6. Corrections to claims already in the repo

- `packages/govee/src/index.ts` says H6076 is "single-zone over LAN
  (community-confirmed)". The razer channel exists at protocol level and
  support is per SKU, so it must be probed, not assumed either way.
- `packages/govee/src/index.ts` credits "Lightwave order" for a BLE last-resort
  fallback. Lightwave has no BLE control. govee-homeassistant routes BLE first
  for an allowlist, and the toolkit refuses implicit failover. Our own rule
  should be: failover for state and single-color control, never for frames, and
  always visible in the UI.
- `follow.ts` reads ProLink beat packets as 60 bytes with fields at offsets 32
  and 46. The verified layout is 96 bytes (0x60) with `nextBeat` in ms and BPM
  at 0x5a.
- `docs/adr/001` does not mention rkbx_link. Add memory reading as option A with
  the license and re-sign caveats above.

## 7. Licensing checklist before any copy

- Add a `THIRD_PARTY_NOTICES` file listing govee-toolkit, govee2mqtt,
  lightwave and govee-homeassistant with their copyright lines.
- Record provenance in the header of each file whose logic was adapted.
- Nothing from rkbx_link or rkbx_os2l enters the tree.

## 8. Sources

- [Govee WLAN guide](https://app-h5.govee.com/user-manual/wlan-guide)
- [govee-toolkit](https://github.com/topics/govee-api) (listed on the topic page) and its npm package `govee-toolkit`
- [wez/govee2mqtt](https://github.com/wez/govee2mqtt)
- [runtalan/lightwave](https://github.com/runtalan/lightwave)
- [lasswellt/govee-homeassistant](https://github.com/lasswellt/govee-homeassistant)
- [grufkork/rkbx_link](https://github.com/grufkork/rkbx_link)
- [fjel/rkbx_os2l](https://github.com/fjel/rkbx_os2l)
- [SignalRGB Govee troubleshooting](https://docs.signalrgb.com/troubleshooting/brand-specific/govee/)
- [govee-lan-control on PyPI](https://pypi.org/project/govee-lan-control/)
- [Govee community: LAN API 101](https://community.govee.com/posts/mastering-the-lan-api-series-lan-api-101/136755)
- [Govee community: device communication channels](https://community.govee.com/posts/govee-device-communication-channels/135660)

# WP07. Rekordbox live providers and the fusion provider

Spec sections: 6, 7, 8, 8.1, 9, 9.1 to 9.5, 10, 105, 119, 120, 128, 145, 146.
Owner additions: rkbx_link ("REALLY IMPORTANT"), OS2L, the clean-room memory
reader, the agent API, and the rule that every serious option is implemented
behind a visible switch with a combined mode (DS-01).
Findings closed: F-LIVE-01 to F-LIVE-16, F-APP-08, F-APP-10, F-MIX-08 (master
acquisition), F-SEC-03 (with `T-SEC-05`), F-QA-06 (AX on Windows part).

## 0. What went wrong last time, specifically

- The only live path was a 1 Hz AppleScript scrape of the Rekordbox window
  that could not tell decks apart, could not tell elapsed from remaining time,
  and marked any deck with a time string as playing.
- The PRO DJ LINK listener expected 60-byte beat packets (they are 0x60 = 96
  bytes), read the wrong offsets, and its data never reached the renderer.
- The "Lighting IPC provider" was a README in an empty folder, and the replay
  test returned its own expected output.
- rkbx_link, the owner's top research item, was never considered. ADR-001
  shipped a `followMode` setting whose default is `preview` (committed
  fixtures, no sync), made a 1 Hz AX poll the first live path, left
  SoundSwitch as "Provider #1" on paper, and never evaluated rkbx_link.

This package builds every serious source as a real provider, fuses them, and
proves each with replay of real captures.

## 1. Required reading

| Source | What to take | License handling |
| --- | --- | --- |
| `grufkork/rkbx_link` README, config docs and OSC address list | OSC output addresses and types, default ports, per-deck versus master messages, supported versions per OS, the re-sign procedure and its consequences | GPL-3.0: read only. Never copy code or offsets. It runs as a separate process the user installs. Never bundle it without an owner decision (`00` section 7) |
| `fjel/rkbx_os2l` | That the local agent API on port 30001 resolves track IDs to paths with a session bearer token; that SoundSwitch accepts OS2L | No license: read only, nothing copied |
| Deep Symmetry `dysentery` protocol analysis (documentation) | PRO DJ LINK packet layouts: keepalive (port 50000), beat (50001), status (50002), magic header, device numbers, beat packet fields | Documentation; cite section names in the file header; do not copy EPL code from `beat-link` |
| OS2L specification (os2l.org) | Message format, DNS-SD service type, beat events | Protocol documentation |
| Ableton Link documentation | Session tempo, beat and phase semantics, quantum | The Link SDK is GPL-2.0-or-later unless Ableton grants its proprietary license; see `T-LIVE-12` |
| `docs/research/prior-art-reuse.md` section 4 | Option table A to D and the version matrix | Ours |
| `docs/rekordbox-capture.md` (existing) | What was already observed on 7.2.10 | Ours |

## 2. Facts to design around

- Installed Rekordbox: 7.2.10.0333 (macOS, Apple Silicon to confirm in
  `T-OPS-01`). No SoundSwitch installed.
- rkbx_link macOS community offsets exist for 7.2.8, 7.2.17 and 7.2.18
  (Apple Silicon); Windows offsets 7.2.2 to 7.2.18 need a paid license. So on
  the owner's current version, rkbx_link does not work on macOS without a
  Rekordbox change. Its macOS setup re-signs Rekordbox with the
  `get-task-allow` entitlement (removes notarization, security warning on
  launch) and runs the reader with `sudo`.
- rkbx_link OSC (defaults: from `127.0.0.1:4450` to `127.0.0.1:4460`):
  `/<deck>/time` (seconds), `/<deck>/bpm/current`, `/<deck>/bpm/original`,
  `/<deck>/track/title|artist|album`, `/<deck>/phrase/current|next|countin`,
  `/<deck>/beat/subdiv/<x>` and beat triggers, where `<deck>` is `master` or
  1 to 4. Verify the exact list against the version the owner installs; the
  provider logs and keeps any address it does not know.
- The SoundSwitch Lighting integration needs Rekordbox 7.2.19 or later and
  SoundSwitch 2.11 or later with a Creative or Professional plan or trial
  (spec 9.1 and F-LIVE-15). The product must run without SoundSwitch
  (spec 120 item 15). The capture work needs SoundSwitch once; the runtime
  never does.
- Whether Rekordbox 7 on a laptop with only a DDJ-FLX4 emits PRO DJ LINK beat
  and status packets at all is unverified. `HW-RB-PL-01` in `wp15` settles it.
- Every provider emits the same `DeckState` (spec 9.5) and a typed
  `ProviderStatus`. Downstream code never branches on the provider (spec 6).

## 3. Contracts (extend `packages/contracts`)

```ts
interface DeckStateV2 extends DeckState {              // spec 9.5 fields stay as they are
  generation: number;                                   // increments on every track load or unload on this deck
  beat: Beat | null;                                    // computed from playhead and the native grid when a grid is known
  beatInBar: 1 | 2 | 3 | 4 | null;
  pitchPercent: number | null;
  sync: boolean | null;
  loopRoll: { active: boolean; beatLength: number | null } | null;
  lastHotCue: { number: number; atNs: Ns } | null;
  phrase: { current: string | null; next: string | null; countInBeats: number | null } | null; // rkbx_link phrase fields
  fieldSources: Partial<Record<keyof DeckStateV2, ProviderId>>; // which provider supplied each field
  quality: Partial<Record<keyof DeckStateV2, "exact" | "derived" | "estimated" | "stale">>;
  raw?: unknown;                                        // diagnostic mode only
}

type ProviderStatus =
  | { state: "starting" }
  | { state: "live"; updateHz: number; ageMs: number }
  | { state: "degraded"; reason: string; updateHz: number; ageMs: number }
  | { state: "unavailable"; reason: string; remedy: string }   // for example "needs Rekordbox 7.2.17 or 7.2.18 on macOS"
  | { state: "failed"; error: string };
```

## 4. Tasks

### T-LIVE-01 Provider contract, generation token and the shared contract suite

- Closes: F-LIVE-13 (with `T-LIVE-14`); probe `P-6-provider-contract`.
- Implement `DeckStateV2`, `ProviderStatus` and `DJLiveProvider` (spec 6,
  with `onConnection` typed as `ProviderStatus`). Every provider increments
  `generation` on load, unload and replacement, and never emits a field from
  the previous generation after the increment (spec 120 item 14).
- A shared contract suite (`packages/rekordbox-live/src/contract-suite.ts`)
  runs against every provider with its simulator: start and stop idempotence,
  status transitions, generation on track change with no metadata leak,
  monotonic `receivedAtNs`, bounded queues (S26), behaviour on malformed
  input (reject and count, never throw into the manager).
- DoD: every provider in this package and `WP09` passes the suite; a
  deliberately leaky test provider fails it (red run saved).

### T-LIVE-02 Provider manager and the fusion provider (DS-01)

- Closes: F-LIVE-14, F-APP-08; probe `P-7-priority`.
- A `ProviderManager` in the main process starts the providers enabled for
  the chosen source, supervises them (restart with backoff), and forwards
  their output to the show host over the typed IPC port (bounded,
  latest-wins per deck).
- `live.provider` (DS-01) selects one provider, or `fusion` (default). Fusion:
  - runs every available provider in parallel;
  - ranks field authority per field, default order from the spec priority
    extended with the owner's sources: `lighting-ipc`, `memory-cleanroom`,
    `rkbx-osc`, `prolink`, `composite-flx4`, `ax`, `os2l`; the order is a
    config list (`live.fusion.authority`) editable in Settings;
  - takes each field from the highest-ranked provider whose value is fresh
    (`live.provider.staleMs`) and whose quality is not `stale`;
  - cross-validates playhead and BPM between providers and raises a
    diagnostic when two disagree by more than `live.fusion.disagreeBeats`;
  - switches authority with hysteresis (`live.fusion.switchHoldMs`) so one
    late packet does not flip sources;
  - fills `fieldSources` and `quality` on every emitted state.
- Every authority switch is an event (S27): logged, recorded, counted, and
  shown in the status bar source badge and the DJ Event Inspector.
- DoD: `P-7-priority` passes (Lighting wins while fresh; Composite takes over
  after staleness; adaptive after both); a fusion test with rkbx-osc and
  prolink simulators disagreeing by one beat raises the diagnostic; the
  Settings page switches `live.provider` at runtime and the status bar shows
  the new source within one second (Playwright).

### T-LIVE-03 rkbx_link OSC provider (`rkbx-osc`)

- Closes: F-LIVE-03.
- Listen on `live.rkbx.oscBind` (UDP, loopback only by default) with a
  persistent socket. Decode OSC 1.0 messages and bundles (write a small
  decoder with golden vectors from the OSC 1.0 specification, or add a
  permissively licensed library with `yarn add` after a license check).
- Map addresses to per-deck state: `time` to `playheadSeconds`,
  `bpm/current` to `effectiveBpm`, `bpm/original` for `playRate`
  (current divided by original), track text fields to a resolution request
  (`T-RBL-07`, disambiguated by original BPM and duration when titles
  collide), `phrase/*` to `phrase`, beat triggers and `subdiv` to beat phase
  cross-checks, `master` deck messages to `master`. Unknown addresses are
  kept under `raw` and counted.
- Infer `playing` from time advancing (with a threshold and a hold window,
  config `live.rkbx.playingEpsilonMs` and `live.rkbx.pauseHoldMs`), and emit
  a seek event when `time` jumps (`runtime.seek.thresholdMs`).
- Quality labels: `playheadSeconds` exact (sample-accurate at the source),
  `playing` derived, `beat` derived from our grid.
- Simulator: `packages/simulator/src/rkbx-osc.ts` sends the documented
  addresses at 60 or 120 Hz on a real UDP socket, driven by a scripted deck
  timeline (play, pause, seek, loop, pitch, track change, master change).
- DoD: provider passes the contract suite; SIM run of every `P-119` row it
  can support (normal play, pitch, play and pause, cue, hot cue, seeks,
  loops as time jumps, two decks, master switch, track replacement) with beat
  error below `runtime.estimator.maxErrorMs`; HW runbook `HW-RB-RKBX-01` (owner
  decision gated, see `T-LIVE-15`) records a real OSC capture that is
  committed as a replay fixture and passes replay.

### T-LIVE-04 rkbx_link setup assistant

- Closes: F-LIVE-03 (setup part).
- A Setup and Settings panel that: detects whether rkbx_link is installed
  (user-selected folder, `live.rkbx.configPath`), reads its config to check
  that OSC output is enabled and pointed at our port, shows the installed
  Rekordbox version and whether rkbx_link supports it on this OS, shows
  whether packets are arriving (rate, last address seen), and explains the
  re-sign and `sudo` consequences in plain words with a link to the project.
- The assistant never runs the re-sign script, never uses `sudo`, and never
  downloads rkbx_link. It shows the owner what to do and verifies the result.
  (Owner decision rules: `00` section 7.)
- DoD: Playwright test against the OSC simulator walks the assistant to
  "receiving"; with no packets it shows the specific missing step; with an
  unsupported Rekordbox version it shows `UNAVAILABLE_ON_THIS_DEVICE` and the
  remedy.

### T-LIVE-05 PRO DJ LINK provider (`prolink`, DS-29)

- Closes: F-LIVE-04.
- Rewrite the parser from the dysentery documentation with golden vectors:
  validate the 10-byte magic header, packet type and length for each port;
  beat packets (port 50001, 0x60 bytes): device number, next-beat and
  next-bar intervals in milliseconds, pitch (0x100000 is 0 percent), BPM
  times 100, beat within bar; status packets (port 50002): track ID and
  source slot, play state flags, master flag, sync flag, beat number,
  pitch; keepalives (port 50000) for peer presence with expiry
  (`live.prolink.peerExpiryMs`).
- DS-29: `passive` (listen only) and `virtual-cdj` (announce as a player
  number `live.prolink.deviceNumber` with keepalives every
  `live.prolink.keepaliveMs`, which some equipment requires before sending
  status), combined `auto` (passive, promote to virtual CDJ only when no
  real device uses the configured number).
- Socket errors are reported as provider status, never swallowed (S5).
  Interface selection follows `govee.lan.interfaces` style rules
  (`live.prolink.interfaces`).
- Simulator: a ProLink emitter on real sockets with scripted players.
- DoD: golden vector tests from the documentation examples; a 60-byte
  random datagram is rejected and counted; SIM run passes the contract suite;
  `HW-RB-PL-01` records whether the owner's setup emits packets and commits a
  capture if it does (if it does not, the capability is
  `UNAVAILABLE_ON_THIS_DEVICE` with that reason, which is a valid outcome).

### T-LIVE-06 Accessibility provider (`ax`) on macOS and Windows

- Closes: F-LIVE-05, F-APP-10, F-QA-06 (AX part).
- One poller, in the main process only (delete the renderer poller), with
  in-flight coalescing and `live.ax.intervalMs` and `live.ax.timeoutMs`.
- macOS: a persistent helper (a JXA script run once with
  `osascript -l JavaScript` that loops and prints JSON lines, or a small
  native addon using the AX API) instead of spawning `osascript` per poll.
  Read the deck panels by their accessibility structure (identify each deck's
  elements by role and position within the deck container, not "the first two
  time strings"), distinguish elapsed and remaining by their labels or by
  which one decreases, read the play button state where exposed, track title
  and artist per deck.
- Windows: the same through UI Automation with a persistent helper
  (PowerShell with the UIAutomation assemblies, or a native addon). If
  Rekordbox's Windows UI does not expose the needed elements, the capability
  is `UNAVAILABLE_ON_THIS_DEVICE` with the evidence (a dump of the element
  tree), not silently absent.
- Permission: detect missing Accessibility permission on macOS and show the
  exact steps; never mark AX as live without it.
- Quality: playhead `estimated` (about one beat), labelled as such.
- DoD: unit tests on recorded element trees from both OSes (committed
  fixtures captured by the runbook `HW-RB-AX-01`); `axBeatToPlayhead` returns
  fractional beats via the grid mapping; a paused deck is reported paused;
  CPU of the helper measured below `live.ax.cpuBudgetPercent`.

### T-LIVE-07 Composite FLX4 provider (`composite-flx4`)

- Closes: F-LIVE-06, F-LIVE-07; probe `P-10-composite`.
- Inputs, each from its own real subsystem: FLX4 MIDI (`WP08`) for play,
  cue, jog, tempo fader, sync, loops, pads, faders and crossfader per deck;
  the library (`WP06`) and native grid; Ableton Link when enabled
  (`T-LIVE-12`); track-open observation; audio timing correction.
- Track-open observation: detect which audio file Rekordbox opens when a
  track loads. macOS: poll the Rekordbox process's open files (`lsof -p <pid>`
  run by a persistent watcher at `live.composite.openFilePollMs`, filtered to
  audio extensions and the library roots) and correlate with the FLX4 LOAD
  press for the deck. Windows: enumerate the process's file handles through a
  native helper (`NtQuerySystemInformation` handle enumeration plus
  `GetFinalPathNameByHandle`), or mark `UNAVAILABLE_ON_THIS_DEVICE` with the
  measured reason. Combined with AX title text when available.
- Playhead estimation: from the load time, play and cue presses, tempo fader
  position mapped through `flx4.tempoRange`, jog activity, and the grid; the
  estimate is corrected by audio timing correction: capture the master output
  (loopback device, `audio.capture.deviceId`), compute an onset envelope, and
  cross-correlate it with the track's precomputed onset envelope around the
  estimated position (window `live.composite.correlationWindowMs`); apply
  corrections through the estimator's smooth correction path (`T-RUN-02`).
  With two decks audible, correlate against a weighted sum by fader
  positions.
- Quality labels: playhead `estimated` until correlation locks, then
  `derived` with the correlation confidence.
- DoD: `P-10-composite` on SIM (virtual MIDI port, library fixture, Link peer,
  synthetic loopback audio rendered from fixture audio at a known offset):
  play state and faders exact, loaded track resolved, playhead error after
  lock below `live.composite.lockedErrorMs`; contract suite passes; HW
  runbook `HW-RB-COMP-01` measures lock time and error against rkbx_link or
  Lighting IPC when available.

### T-LIVE-08 Rekordbox local agent API (port 30001)

- Closes: F-LIVE-09.
- The Rekordbox agent listens on `live.agentApi.port` and resolves track IDs
  to paths when given the session bearer token (rkbx_os2l shows this; no
  code is taken from it). Implement a client that: checks liveness without a
  token (to report "agent present"), and, when a token source is available,
  resolves content IDs to paths as a resolver step in DS-22.
- Token sources, each implemented and each reported: the memory reader
  (`T-LIVE-11`, consent required), and any documented file or log location
  you find during `HW-RB-AGENT-01` (record the evidence; if none exists, say so).
  The token is a secret: kept in memory only, never logged.
- DoD: client tests against a local fake agent with token checks; resolver
  chain uses it when present and reports "agent API: no token" otherwise.

### T-LIVE-09 Lighting IPC provider: capture tooling, fixtures, decoder, replay

- Closes: F-LIVE-01, F-LIVE-02, F-LIVE-15; probes `P-8-lighting-provider`,
  `P-9.2-surface-inventory`, `P-9.3-matrix-complete`, `P-9.4-capture-nonempty`,
  `P-9.5-decoder-fields`, `P-128-replay-decodes`.
- Capture tooling (`tools/capture/rekordbox/`), all runnable by the owner:
  - Surface inventory scripts: macOS (`lsof -i -U -P -p`, `nettop`, `log
    stream --predicate`, `dns-sd -B`, `fs_usage` notes, loopback `tcpdump`);
    Windows (`netstat -abno`, `Get-NetTCPConnection`, named pipe listing,
    ETW or Process Monitor instructions, loopback capture with Npcap). Both
    also collect the Rekordbox and SoundSwitch log files (locate them from
    each app's documented log folders and from the processes' open files),
    probe every localhost TCP listener the two apps own with an HTTP `GET /`
    and a WebSocket upgrade attempt (recording status lines and headers only),
    and list mDNS services. Output `surfaces.json` per OS covering every
    spec 9.2 surface: TCP, UDP, mDNS and Bonjour, Unix sockets, local
    WebSockets, localhost HTTP, IPC pipes, process file descriptors,
    Rekordbox logs and SoundSwitch logs.
  - A capture matrix runner (a guided CLI or a Diagnostics page) that walks
    the 27 actions times 7 conditions of spec 9.3 one at a time from idle,
    records the transport with timestamps, writes one fixture per cell in the
    spec 9.4 layout with `rekordboxVersion`, `platform`, `action`,
    `condition`, raw `capture` (base64 of the byte stream plus framing), the
    decoder version, and `expectedEvents` filled by the owner's confirmation
    of what happened (not by the decoder).
- Decoder: framing and message parser for the transport the inventory finds
  (TCP, WebSocket, OSC, pipe or other), mapping to `DeckStateV2` with every
  unknown field retained under `raw` (spec 9.5). The decoder is registered in
  the version registry (`T-LIVE-13`).
- Replay harness (`T-QA-03`): raw capture through the real decoder at 1x, 2x,
  10x and step, compared to `expectedEvents`. Fixture lint rejects empty
  captures (the three existing hand-written 7.2.10 JSON fixtures are deleted
  or moved to `test-fixtures/synthetic/` with honest names).
- The runtime never needs SoundSwitch: after decoding, the provider talks to
  Rekordbox directly if the protocol allows it (handshake replay from
  captures), or the capability is recorded as "requires SoundSwitch running",
  which fails spec 120 item 15 and is reported to the owner as a finding.
- Owner gating: installing Rekordbox 7.2.19+ and a SoundSwitch plan or trial
  is an owner decision (`T-LIVE-15`). Until the owner runs the capture, build
  and verify all of the tooling (test the inventory scripts and the matrix
  runner against a fake target process that opens TCP, UDP, WebSocket and
  pipe endpoints), and write the complete runbook `HW-RB-LIGHT-01`. No decoder
  is claimed and no protocol is guessed before real captures exist; a
  decoder tested only on invented frames proves nothing (S2). The task stays
  `BLOCKED-OWNER-DECISION`, then `BLOCKED-HARDWARE`, and the capability
  status stays `MISSING` in `capabilities.yaml` until the captures land.
- DoD: after the owner runs `HW-RB-LIGHT-01` on macOS and Windows: all matrix
  cells present per OS, every fixture non-empty, replay passes at all speeds,
  provider passes the contract suite, and the app runs with SoundSwitch
  uninstalled.

### T-LIVE-10 OS2L provider (`os2l`)

- Closes: F-LIVE-10.
- Implement an OS2L endpoint per the OS2L specification: advertise the DNS-SD
  service, accept client connections, parse beat events (beat position, BPM,
  strength, change flag) and button or command messages; map to `DeckStateV2`
  for the master deck with quality `derived` (OS2L carries beats, not a
  playhead).
- Useful sources: rkbx_os2l on Windows (when the owner uses it), VirtualDJ,
  and any tool that speaks OS2L. It is also a fallback clock for the adaptive
  director (DS-23).
- DoD: tests with a scripted OS2L client over a real TCP socket; contract
  suite; the provider appears in fusion with its authority rank.

### T-LIVE-11 Clean-room memory reader (`memory-cleanroom`)

- Closes: F-LIVE-03, F-SEC-03 (with `T-SEC-05`).
- Only with `live.memoryReader.enabled` and the consent flow of `T-SEC-05`.
  Implement a reader for Rekordbox's deck state (playhead samples, BPM,
  master deck, loaded track identifiers) with version-specific pointer paths
  in a data file (`live.memoryReader.offsetsFile`), built by our own
  documented process: a scanner tool that finds the values from known
  observations (a paused deck at a known time), writes candidate paths, and
  verifies them across restarts. No rkbx_link code or offsets are copied or
  consulted as data.
- Runs as a separate helper process with the privileges it needs (the app
  itself never runs elevated), speaking a local socket to the main process;
  the helper is signed and its privileges and the re-sign requirement are
  explained in the consent flow.
- Every offsets file carries the Rekordbox version, platform, date and the
  verification record; an unknown version shows `UNVERIFIED REKORDBOX
  VERSION` and the reader stays off.
- DoD: scanner and reader tested against a test target process that mimics
  the structure (committed, our own code); HW runbook `HW-RB-MEM-01` (owner
  decision gated) produces an offsets file for the owner's version and a
  replay fixture from real use.

### T-LIVE-12 Ableton Link participation

- Closes: F-LIVE-11.
- The Link SDK is GPL-2.0-or-later unless Ableton grants its proprietary
  license, so it cannot be linked into AutoLight without an owner decision.
  Implement the options behind `live.link.mode` (DS-36): `sidecar` (a
  separately installed Link bridge process such as Deep Symmetry's Carabiner,
  which exposes Link over a local TCP socket; check its license and treat it
  like rkbx_link: user-installed, never bundled without a decision),
  `sdk` (link the SDK in a native addon only if the owner obtains Ableton's
  license), and `auto` (sidecar when present, SDK build when licensed,
  otherwise `UNAVAILABLE_ON_THIS_DEVICE` with the reason).
- Use Link as: a tempo and phase input to the composite provider and the
  adaptive clock (DS-23), and as a cross-check for the fusion provider. Also
  publish our show clock into the Link session when enabled
  (`live.link.publish`), so other tools can follow AutoLight.
- DoD: tests against a scripted sidecar speaking the bridge's protocol; with
  the sidecar absent the Settings page shows the remedy; HW runbook
  `HW-RB-LINK-01` with Rekordbox's Link enabled.

### T-LIVE-13 Version registry, qualification records and the unverified banner

- Closes: F-LIVE-08; probes `P-145-unverified-banner`, `P-146-registry`.
- `RekordboxProtocolDefinition` registry (spec 146) per provider:
  `versionRange`, `platform`, decoder, fixture set, qualification record
  (date, machine, runbook, results). Replace `isSupported` string prefixes.
- Detect the running Rekordbox version (macOS bundle `Info.plist`, Windows
  file version) and, for each provider, report `qualified`, `unverified`
  (probing allowed, not declared supported) or `unsupported`.
- `UNVERIFIED REKORDBOX VERSION` appears in the status bar and on the source
  badge (never as a modal during Live, spec 144).
- DoD: E2E with a simulated version 9.9.9 shows the banner; the registry is
  generated from committed fixture metadata; a new fixture set flips a
  version to qualified only when the replay suite passes.

### T-LIVE-14 Master deck, loop, pitch, SYNC, hot cue and roll state

- Closes: F-LIVE-12, F-LIVE-13, F-MIX-08.
- Acquire these fields from every provider that has them (Lighting IPC,
  memory reader, rkbx-osc master messages, ProLink status flags, FLX4 buttons
  and LEDs as secondary truth) and fuse them. The mixer consumes `master`
  (`T-MIX-01`, `T-MIX-03`); the runtime consumes loops and rolls (`T-RUN-04`).
- FLX4-observed states (a loop button press, a pad roll) are hints with
  quality `estimated` unless a DJ-software source confirms them (spec 11:
  never override a stronger source).
- DoD: SIM tests for each field from each provider that supplies it; a
  track switch mid-loop does not carry the loop into the new generation.

### T-LIVE-15 Version and dependency decision packet for the owner

- Closes: F-LIVE-15, F-LIVE-16.
- Write `docs/finish/evidence/T-LIVE-15/decision.md` and a Settings panel
  "Rekordbox live sources" that shows, for the installed version, which
  providers are available, which need a Rekordbox update (to 7.2.17 or 7.2.18
  for rkbx_link on macOS; to 7.2.19+ for Lighting), which work on the
  current 7.2.10 only on Windows with a paid rkbx_link license, which need
  SoundSwitch,
  which need re-signing and `sudo`, and the measured accuracy of each from
  SIM and HW runs. The owner chooses; the app never acts on these choices
  itself.
- A test proves spec 120 item 15: the full app runs every non-Lighting
  provider with SoundSwitch absent.
- DoD: decision document with measurements; the panel renders the matrix
  from the registry (not hardcoded text).

## 5. Config keys added by this package (added to `03` section 3.8)

`live.fusion.authority` (list), `live.fusion.disagreeBeats` (0.25),
`live.fusion.switchHoldMs` (500), `live.rkbx.playingEpsilonMs` (5),
`live.rkbx.pauseHoldMs` (150), `live.prolink.interfaces` (all eligible),
`live.ax.cpuBudgetPercent` (3), `live.composite.openFilePollMs` (500),
`live.composite.correlationWindowMs` (4000), `live.composite.lockedErrorMs`
(15), `live.link.mode` (DS-36, `auto`), `live.link.publish` (false). All
defaults are unmeasured and say so in their receipts.

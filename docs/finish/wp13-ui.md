# WP13. User interface

Spec sections: 88 to 102, 136, 137, 139, 142 to 144; owner requests (every
configuration visible; the room editor, which lives in WP05). Findings
closed: F-UI-01 to F-UI-19, F-APP-08 (UI part), F-APP-11 (UI part), F-APP-12
(UI part), F-APP-14, F-APP-17, F-APP-18 (UI part), F-APP-19 (UI part),
F-FLX-05 (UI part), F-GOV-11 (UI part), F-GOV-26 (UI part).

## 0. Rules for every screen

- The UI observes show host snapshots and sends typed intents
  (`04-target-architecture.md`). It owns no timing, no I/O and no
  authoritative state (S7).
- Every number on screen is measured, configured, or labelled as a default or
  "unmeasured" (S6). No literal metrics in components (ast-grep rule).
- Every screen is driven by Playwright against the real Electron app
  (`_electron.launch`), in Simulator mode on CI and on the owner's machine for
  hardware runs. Each task's DoD includes screenshots at 1440 by 900 and at the
  owner's Live distance review (`T-UI-12`).
- The design language is spec 88: deep neutral background, dense and well
  ordered information, large timing typography, minimal chrome, one
  restrained accent family, semantic status colours, 60 fps animation. Not a
  smart-home dashboard, not neon, not glass, not giant rounded cards.

## 1. Tasks

### T-UI-01 Component library and a single application root

- Closes: F-UI-14, F-APP-14; probes `P-142-components`, `P-88-frame-time`.
- Remove the second `createRoot` in `shell.tsx`; one root in `main.tsx`.
- Build the 14 spec 142 components once, in
  `apps/desktop/src/renderer/components/` (inside the Vite root and the `@`
  alias, where the existing components live; if `T-ARC-05` restructures
  `src/` to the spec 83 layout, it moves the components and updates the Vite
  root and alias in the same change), with a story or test page each, typed
  props, and no page-specific copies:
  StatusDot, MetricBadge, DeckPanel, Waveform, BeatRuler, SectionLane,
  EventLane, FixturePreview (the WP05 room view), DeviceTile,
  HealthIndicator, InspectorPanel, TimelineCursor, CueList, MasterControls.
  Plus the components this plan adds: ConfigField (renders any config key
  with unit, range, receipt, live-safe badge), DecisionSwitch (DS selector
  with measurements), CapabilityBadge (the capability status vocabulary),
  SourceBadge (REKORDBOX or SERATO with provider and quality).
- Design tokens (colour, type scale, spacing, motion) in one file; semantic
  colours never carry meaning alone (icons and text accompany them).
- DoD: component tests; jscpd shows no duplicated component code; a
  performance trace of the component gallery page with realistic data (2,000
  cells in FixturePreview, two Waveforms) shows p95 frame time under 16.7 ms.
  The Live screen measurement for `P-88` is owned by `T-UI-13`.

### T-UI-02 Live screen

- Closes: F-UI-03, F-UI-04, F-UI-05, F-UI-15; probes `P-89-live-layout`,
  `P-90-drop-in-8`, `P-91-waveform`, `P-93-upcoming`, `P-70-levels`.
- Layout per spec 89. Status bar: source (`REKORDBOX` or `SERATO`, provider
  and quality, `UNVERIFIED REKORDBOX VERSION` when applicable), timing health
  per deck, Govee `n/m` online and armed, output FPS (measured), end-to-end
  latency estimate, analysis level of the playing tracks, SIMULATOR badge in
  Simulator mode.
- Deck cards with all 17 spec 90 fields bound to snapshot data (artwork,
  track, artist, source, play state, playhead, native BPM, effective BPM,
  pitch, beat, bar, phrase, section, next structural event, channel fader,
  audible weight, analysis quality) and the predictive field large ("DROP IN
  8", "BREAKDOWN IN 16", "BUILD").
- Master clock (BPM and beat within bar of the master deck).
- Dual waveform (spec 91): source waveform (PWV7 or our overview), grid,
  downbeats, sections, phrases, fills, builds, drops, breakdowns, hot cues,
  loops and playheads for both decks, coloured semantically, Canvas or WebGL,
  60 fps.
- Venue preview: the WP05 room view with every real cell, showing the exact
  logical output (spec 92, `T-ROOM-10`).
- Upcoming cues per deck with relative times in beats and bars (spec 93)
  from the show host (`T-MIX-06`).
- Emergency bar (`T-UI-03`).
- DoD: `P-89`, `P-90` (SIM deck 8 beats before a drop shows "DROP IN 8"),
  `P-91` component test with a known model, `P-93` with two decks at
  different beats, `P-70` (each analysis level shown with its inputs).

### T-UI-03 Emergency controls and shortcuts

- Closes: F-UI-02, F-APP-17; probe `P-94-blackout-latency`.
- BLACKOUT, FULL WHITE, FREEZE LOOK, AUTO or MANUAL, MASTER INTENSITY always
  visible on Live and reachable from every screen (a compact bar). No modal
  confirmation (spec 94).
- Shortcuts (configurable in Settings, defaults documented): B blackout
  (toggle), W white (hold or toggle per `ui.shortcuts.whiteMode`), F freeze
  (toggle), A auto (resume with the configured quantization), M manual,
  Up and Down master intensity steps, 1 to 9 master presets, Space as
  configured. They work when focus is in any field except text inputs, and
  the command palette's Emergency items call the same intents.
- The master intensity shows the real value from the show host (not "80%").
- DoD: `P-94` (keypress to UDP send, p99 under 100 ms, target 20 ms,
  measured from Playwright keypress timestamps to recording transport
  timestamps); tests for every shortcut and palette item.

### T-UI-04 Manual lane for performance

- Closes: F-UI-01, F-UI-18, F-APP-12 (UI), F-APP-19 (UI).
- Rework the manual lane into a compact, performance-grade panel: force low
  or high energy, blinder on next phrase (restraint-aware, `T-PLAN-05`),
  manual palette pick from the track's palette (not arbitrary swatches by
  default; free colour behind an explicit "custom" control), flash on beat,
  alternate A or B, spatial target from the venue's groups, splits and zones
  (WP05), sensitivity (the style's reactive amount within bounds). Every
  control sends a typed intent with a runtime effect (`T-RUN-07`) and shows
  its state from the snapshot.
- The consumer "party" styling is removed from Live (spec 88, 151).
- DoD: each control has an E2E test that observes the frame change at the
  recording transport; owner review screenshot.

### T-UI-05 Library screen, readiness and the preanalysis queue

- Closes: F-UI-06, F-UI-16; probes `P-95-library`, `P-137-readiness`,
  `P-139-queue`.
- Left: Rekordbox playlists (folders, history) and Serato crates (and smart
  crates). Table (spec 95): track, artist, BPM, key, duration, native grid,
  native structure, deep analysis, show, last modified, and status (READY,
  ANALYZING, NEEDS ANALYSIS, GRID WARNING, SOURCE MISSING, FAILED with
  reason). Virtualized for large libraries, sortable, searchable.
- Readiness (spec 137): FULL, STRUCTURED, ADAPTIVE badges; clicking lists
  every capability input (`T-ANA-15`) with a check or a reason.
- Preanalysis (spec 139): select playlists or crates and queue them; queue
  panel with Queued, Analyzing, Compiling, Ready, Failed, progress, cancel,
  retry, priority; persists across restarts.
- DoD: `P-95`, `P-137`, `P-139` E2E on the fixture library; 10,000-row
  library scrolls at 60 fps.

### T-UI-06 Track Inspector

- Closes: F-UI-07, F-UI-08; probes `P-96-inspector`, `P-17-grid-warning`
  (UI).
- Synchronized lanes (spec 96): waveform, beatgrid, sections, PSSI phrases,
  All-In-One structure, bass, drums, vocals, other, novelty, build
  probability, drop probability, musical events (with evidence tooltips),
  generated lighting cues (with the planner's `reason`), plus GRID_WARNING
  markers and the plan diagnostics panel (spec 115).
- Click any beat to audition: the show host renders that beat for this track
  on the real venue in the preview (simulation, no output unless the owner
  toggles "send to lights").
- Selection follows the chosen deck or track; data is fetched once per track
  and cached, not refetched per tick.
- Blend-space A/B viewer for DS-09.
- DoD: `P-96` (click beat 257, preview shows the beat-257 frame hash); deck B
  selection shows deck B.

### T-UI-07 Track corrections

- Closes: F-UI-09; probe `P-97-corrections`.
- Spec 97 operations in the Inspector: change section label, move event,
  delete false drop, add missing drop, mark fake drop (with actual impact
  beat), change style, regenerate one section, lock a section, plus undo and
  redo. Edits persist (`T-PLAN-11`) and show who and when.
- DoD: `P-97` E2E; edits survive restart and a planner version bump.

### T-UI-08 Venue and Device screens

- Closes: F-UI-10 (venue part), F-GOV-11 (UI); probes `P-98-venue-canvas`,
  `P-99-device-actions`.
- Venue: the WP05 room editor (`T-ROOM-03`) and mapping wizard
  (`T-ROOM-04`) with spec 98 operations.
- Device screen and tiles (spec 99): name, SKU, connection mode and
  effective transport (DS-31), IP, BLE address, firmware, segments
  (measured, or "unmeasured"), qualified resolution, current FPS, sent and
  superseded frames, latency (measured or SKU default with badge), last
  response, health, capability status per transport, and IDENTIFY, TEST
  CHASE, RECALIBRATE (`T-GOV-12`) plus the transport mode dropdown.
- DoD: `P-98`, `P-99` (each action produces the documented bytes at the
  recording transport); tiles show "unmeasured" before qualification.

### T-UI-09 Setup experience

- Closes: F-UI-10 (setup part), F-APP-08 (UI), F-FLX-05 (UI); probes
  `P-100-setup`, `P-136-rekordbox-first`.
- Ten steps (spec 100) with real checks, each marked done only with evidence:
  1 DJ software (auto-detect installed Rekordbox and Serato with versions;
  Rekordbox recommended when both exist; live source assistant from
  `T-LIVE-04` and `T-LIVE-15`); 2 controller (`T-FLX-07`); 3 library (reader
  opens, counts shown); 4 lights (discovery with the network checklist); 5
  identify (lights one at a time, owner confirms); 6 venue placement (room
  editor, DJ position); 7 segment orientation (directional chase, correct or
  reverse; strip mapping wizard for perimeter strips); 8 qualification
  (automatic benchmark, `T-GOV-11`); 9 analysis (choose playlists or crates,
  model preparation with consent for downloads); 10 preview (simulated show
  on the real rig).
- Re-runnable per step from Settings; progress persisted.
- DoD: `P-100` fresh-profile E2E on SIM through all ten steps; `P-136` with
  both DJ apps detected.

### T-UI-10 Diagnostics and the DJ Event Inspector

- Closes: F-UI-11, F-GOV-26 (UI); probes `P-101-diagnostics`,
  `P-102-event-inspector`, `P-111-trust`.
- Ten tabs (spec 101) with live data: DJ Events (the Event Inspector: monotonic
  timestamp, source, deck, event, raw state, normalized state, latency,
  record to `.ndjson`), Transport (per provider status, rates, ages, fusion
  authority), Beat Clock (per deck estimator error, corrections, health),
  Track Resolver (`T-RBL-07`), Analysis (worker, queue, inputs), Planner
  (diagnostics, rejections), Renderer (tick timings, layer contributions),
  Fixtures (per device metrics `T-GOV-19`, network trust `T-GOV-16`, the
  SignalRGB-style checklist results, port 4002 conflicts), Latency (per
  fixture measured latency and spread), Logs (structured log viewer with
  filters).
- No forced metrics: values come from `T-OPS-03`.
- DoD: `P-101` each tab shows changing live values on SIM; `P-102` recording
  replays into the simulator (`T-DATA-06`).

### T-UI-11 Settings: every configuration visible

- Closes: F-UI-17 (with `T-CFG-05`).
- Every key in the registry, grouped as in `03`, searchable, with value,
  default, unit, range, receipt (measured, spec, upstream, unmeasured),
  live-safe badge, reset, and per-venue or per-device scope where relevant.
  Protocol invariants shown read-only with their source. Every decision
  switch (DS-01 to DS-36) on its own page with all modes, the combined mode,
  the current choice and the measurements the task lists.
- Changes that are not live-safe are queued until Live ends, with a visible
  pending list (`T-CFG-07`).
- DoD: Playwright test enumerates the registry and asserts a visible control
  for every key and every DS; a change persists across restart.

### T-UI-12 Accessibility, ergonomics and the no-modal guard

- Closes: F-UI-12, F-UI-13; probes `P-143-a11y`, `P-144-no-modal`.
- Live readable from several feet: timing typography at least
  `ui.live.minTimingFontPx`, body at least `ui.live.minBodyFontPx`, critical
  targets at least 44 px, WCAG AA contrast, labels on every control, no
  colour-only states. axe-core in E2E.
- No surprise modal during Live (spec 144): a modal guard in the dialog layer
  refuses any modal while Live is active and routes the message to the
  status area and notification list; the Toaster respects Live rules
  (`isModalAllowed` used, not dead).
- Owner distance review: the owner reviews the Live screen from their DJ
  position and records a pass or a list of changes (evidence).
- No confirmation dialog for any Live action (spec 94 and 144), including
  BLACKOUT, FULL WHITE, FREEZE, AUTO and MANUAL, style changes and venue
  switches; destructive non-Live actions outside Live may confirm inline.
- DoD: `P-143` axe report with zero serious issues; `P-144` injects analysis
  failure, device loss and an update notice during Live and asserts no
  dialog; during those injected failures it also presses B, W, F and A and
  asserts each takes effect at the recording transport within the `P-94`
  bound (emergency controls remain active, spec 144), and that no
  confirmation dialog appears for any Live action; owner review note.

### T-UI-13 UI performance with real data volumes

- Closes: spec 88 and 117 (UI part).
- Snapshot consumption is throttled and diffed; the room view renders 2,000
  cells at 60 fps; waveforms render with cached tiles; long lists are
  virtualized.
- DoD: performance traces on the reference Mac and Windows machine with 2,000
  cells and two decks: p95 frame time under 16.7 ms.

### T-UI-14 Styles in the UI

- Closes: F-APP-11 (UI), F-APP-18 (UI); probe `P-135-styles`.
- Style picker with the seven spec names (Club, House, Festival, Lounge, Pop,
  Dark, Minimal) and custom styles; a style editor exposing all 11
  properties with previews in the Inspector; style changes during playback
  apply at the next phrase boundary (`T-RUN-08`) with a visible "pending"
  state.
- DoD: E2E switches style mid-track and observes the boundary handover.

### T-UI-15 Simulator mode

- Closes: F-UI-19 (with `T-TRU-02`).
- An explicit Simulator mode (Setup and Settings toggle) with a persistent
  SIMULATOR badge in the title bar and status bar; a scenario picker (normal
  night, pitch and loops, two-deck transition, device loss, source loss) that
  drives the protocol simulators; the full production pipeline runs.
- DoD: E2E runs each scenario; a video of the normal-night scenario in
  evidence.

## 2. Config keys added (added to `03` section 3.10)

`ui.shortcuts.*` (map of actions to keys), `ui.shortcuts.whiteMode`
(`hold`), `ui.live.minTimingFontPx` (48), `ui.live.minBodyFontPx` (16).

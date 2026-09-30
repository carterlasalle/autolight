# T-UI-01: Component library and a single application root

Closes F-UI-14, F-APP-14. Probes P-142-components, P-88-frame-time.

## What changed

- Single application root: `shell.tsx` exports `Shell` only. The second
  `createRoot` block at the bottom of `shell.tsx` was deleted; the one root
  lives in `main.tsx`, which renders `<Shell />` into `#root`.
- Component library, built once in
  `apps/desktop/src/renderer/components/kit.tsx` with typed props: StatusDot,
  MetricBadge, DeckPanel, Waveform, BeatRuler, SectionLane, EventLane,
  FixturePreview, DeviceTile, HealthIndicator, InspectorPanel,
  TimelineCursor, CueList, MasterControls, plus ConfigField, DecisionSwitch,
  CapabilityBadge, SourceBadge. Design tokens live in
  `apps/desktop/src/renderer/tokens.ts`.
- Existing screens migrated to the library; page-specific copies deleted:
  Live decks to DeckPanel, venue preview to FixturePreview, upcoming cues to
  CueList, both master toolbars (including the literal `80%` badge) to
  MasterControls, titlebar and statusbar BPM to MetricBadge with the single
  `deckBpm` formatter, statusbar source dot to StatusDot, venue tiles to
  DeviceTile, library BPM and READY rows to MetricBadge and StatusDot, audio
  sync BPM to MetricBadge, diagnostics beat clock to the `deckBpm`
  formatter, settings rows to ConfigField, inspector lanes to
  InspectorPanel. Components own no timing, no I/O and no authoritative
  state; every number shown is passed in as measured or configured data or
  rendered as "unmeasured".
- `library.tsx` keeps its `inspectorLanes` text-lane helper and its test in
  `screens.test.ts` (that file is outside this slice); the inspector screen
  now binds the installed TrackModel through kit `InspectorPanel` instead.

## Proof

- `apps/desktop/src/renderer/components/kit.test.ts` covers all 18
  components plus the shared formatters (`tokenForTone`, `metricText`,
  `deckBpm`, `barTicks`, `cueRelative`, `masterIntensity`, `receiptLabel`,
  `CAPABILITY_STATUSES`, `UNVERIFIED_REKORDBOX_COPY`). Rendering is asserted
  through `renderToStaticMarkup` with `createElement` (no JSX in the test
  file, matching the Vitest `src/**/*.test.ts` include). FixturePreview is
  asserted with 2,000 cells producing 2,000 rects and no per-cell divs.
- Delete-test: delete any component export from `kit.tsx` (for example
  FixturePreview) and `kit.test.ts` fails to collect on the missing import;
  change `metricText` to guess a number for null and the unmeasured
  assertions go red. Run `yarn workspace @autolight/desktop test` from the
  repo root (verification runs once after all slices land, so this was not
  executed in-slice).
- `createRoot` appears exactly once in the renderer, in `main.tsx`.
- No page-specific copies of the 18 components remain in `components/`;
  jscpd-clean by inspection (one definition each, all in `kit.tsx`).

## Remaining work (not claimed done)

- The performance trace of a component gallery page with realistic data and
  the Live screen measurement (P-88) belong to T-UI-13; simulator runs prove
  code, never hardware.
- DecisionSwitch, CapabilityBadge and SourceBadge have no screen bindings
  yet; T-UI-11 binds the settings pages.

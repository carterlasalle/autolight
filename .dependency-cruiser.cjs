/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "renderer-no-show-internals",
      comment: "S7: renderer observes snapshots and sends intents; it owns no timing or output (T-TRU-04). ACCEPTED DEVIATION (T-ANA-12 follow-up, 2026-10-02): apps/desktop/src/features/live/live.ts is a pure view-model (mixDown plus renderFrame over already-installed cues, no clock, no sockets, no output); the show host owns time and output. CI counts this as 1 known error, ratcheted, until the snapshot-render path replaces it.",
      severity: "warn",
      from: { path: "apps/desktop/src" },
      to: { path: "(show-runtime|show-mixer|packages/renderer|packages/govee)", pathNot: "\\.test\\.ts$" },
    },
    {
      name: "renderer-no-simulator",
      comment: "S3: production never imports the simulator except the Simulator mode entry (T-TRU-02, T-QA-02 TestChannel): electron/services/simulator-show.ts owns the test-build show loop; production IPC never touches it.",
      severity: "error",
      from: { path: "apps/desktop/(src|electron)", pathNot: "(services/simulator-show|\\.test)" },
      to: { path: "packages/simulator", pathNot: "\\.test\\.ts$" },
    },
    {
      name: "planner-no-device-internals",
      comment: "Plans are venue independent (T-PLAN-01).",
      severity: "error",
      from: { path: "packages/show-planner" },
      to: { path: "packages/(govee|venue)", pathNot: "\\.test\\.ts$" },
    },

    // ---- Ownership table: 04-target-architecture section 1 (T-ARC-05) ----
    // Resource | Owner | Nobody else may ...
    {
      name: "ownership-ui-state",
      comment: "UI state | Renderer | main services and the show host never import renderer sources.",
      severity: "error",
      from: { path: "(^packages|apps/desktop/electron)" },
      to: { path: "apps/desktop/src", pathNot: "\\.test\\.ts$" },
    },
    {
      name: "ownership-show-clock",
      comment: "Show clock and all show-time state | Show host | main services never import the show runtime.",
      severity: "error",
      from: { path: "apps/desktop", pathNot: "\\.test\\.ts$" },
      to: { path: "packages/show-runtime" },
    },
    {
      name: "ownership-db-single-owner",
      comment: "Database | main storage-service | no other package or main service opens the DB file.",
      severity: "error",
      from: { path: "(^packages|apps/desktop/(src|electron))", pathNot: "(packages/storage|electron/services/storage-service|\\.test\\.ts$)" },
      to: { path: "packages/storage" },
    },
    {
      name: "ownership-library-single-owner",
      comment: "Rekordbox and Serato libraries | main library-service | no other main module or renderer opens library files.",
      severity: "error",
      from: { path: "apps/desktop/(src|electron)", pathNot: "(electron/services/(library-service|identity-service)|\\.test\\.ts$)" },
      to: { path: "packages/(rekordbox-library|serato)" },
    },
    {
      name: "ownership-python-single-owner",
      comment: "Python worker | main analysis-supervisor | nothing else spawns or imports the worker client. Intra-package barrel imports (index.ts to sibling modules) are not cross-owner traffic.",
      severity: "error",
      from: { path: "(^packages|apps/desktop/(src|electron))", pathNot: "(packages/analysis-client|electron/services/analysis-supervisor|\\.test\\.ts$)" },
      to: { path: "packages/analysis-client" },
    },
    {
      name: "ownership-govee-sockets",
      comment: "Govee LAN sockets (4002 listener, 4001 to 4003 control) | show host govee-manager | no other module opens UDP. Exceptions: the Govee LAN manager itself, the DJ provider observer (PRO DJ LINK owns :50001, main services), and the TEST-BUILD simulator show loop (loopback sim + recording sender only, never production IPC).",
      severity: "error",
      from: { path: "apps/desktop/electron", pathNot: "(govee-lan|services/provider-manager|services/simulator-show)\\.ts$" },
      to: { path: "dgram$" },
    },
    {
      name: "ownership-provider-io-main-only",
      comment: "DJ provider sockets, OSC, MIDI, AX | main services | the renderer reads no DJ state directly; it renders snapshots. NOTE: depcruiser does not resolve @autolight/* workspace specifiers in this repo (no edges recorded), so this rule cannot fire on barrel imports; the blocking enforcement is the ast-grep no-renderer-provider-barrel rules (ts + tsx), red-run proven. Keep this as warn for resolved-path violations.",
      severity: "warn",
      from: { path: "apps/desktop/src", pathNot: "\\.test\\.ts$" },
      to: { path: "packages/(rekordbox-live|serato|controller-flx4|analysis-client)" },
    },

    // ---- Spec 155 arrows (the pipeline, upstream to downstream) ----
    {
      name: "arrow-planner-upstream-only",
      comment: "Spec 155: TrackModel to ShowPlanner to ShowPlan; the planner never reaches downstream stages.",
      severity: "error",
      from: { path: "packages/show-planner" },
      to: { path: "packages/(show-runtime|show-mixer|renderer|venue|govee)", pathNot: "\\.test\\.ts$" },
    },
    {
      name: "arrow-runtime-before-mixer",
      comment: "Spec 155: ShowRuntime feeds the mixer and touches no output or presentation.",
      severity: "error",
      from: { path: "packages/show-runtime" },
      to: { path: "packages/(show-mixer|renderer|venue|govee)", pathNot: "\\.test\\.ts$" },
    },
    {
      name: "arrow-mixer-no-transport",
      comment: "Spec 155: ShowMixer mixes decks and audio overlay; it never talks to devices, libraries or the database.",
      severity: "error",
      from: { path: "packages/show-mixer" },
      to: { path: "packages/(govee|venue|storage|rekordbox-live|rekordbox-library|serato|controller-flx4|analysis-client)", pathNot: "\\.test\\.ts$" },
    },
    {
      name: "arrow-renderer-to-venue-only",
      comment: "Spec 155: Renderer maps ShowPlan onto the VenueModel; it never imports transports, analyses or upstream stages.",
      severity: "error",
      from: { path: "packages/renderer" },
      to: { path: "packages/(govee|storage|rekordbox-live|rekordbox-library|serato|controller-flx4|analysis-client|show-planner|show-runtime|show-mixer)", pathNot: "\\.test\\.ts$" },
    },
    {
      name: "arrow-venue-no-transport",
      comment: "Spec 155: VenueModel resolves cells; frames leave through the Govee manager, never from the venue package.",
      severity: "error",
      from: { path: "packages/venue" },
      to: { path: "packages/(govee|renderer|show-planner|show-runtime|show-mixer|storage)", pathNot: "\\.test\\.ts$" },
    },
    {
      name: "arrow-govee-is-sink",
      comment: "Spec 155: the Govee local streams are the sink; the package never imports planning, runtime, rendering, or libraries.",
      severity: "error",
      from: { path: "packages/govee" },
      to: { path: "packages/(show-planner|show-runtime|show-mixer|renderer|venue|rekordbox-live|rekordbox-library|serato|analysis-client|track-model|storage)", pathNot: "\\.test\\.ts$" },
    },
  ],
  options: { doNotFollow: { path: "node_modules" }, exclude: "(^|/)dist(/|$)", tsPreCompilationDeps: true },
};

// Decision switch metadata (T-CFG-06, DS-01 to DS-36).
//
// Each decision in docs/finish/03-config-and-decisions.md section 4 is a
// registry key (or, where noted, a code-level chain) with its options, the
// combined mode that takes the best of each, the default, and the metrics that
// inform the owner's choice. The Decision switches tab, the status bar
// indicator and the diagnostics comparison panel all read this table.

export interface DecisionOption {
  id: string;
  /** Short explanation of what the mode does. */
  summary: string;
  pros: string[];
  cons: string[];
  /** What must hold for the option to be selectable. */
  requires?: string[];
}

export interface DecisionMeta {
  /** "DS-01" to "DS-36". */
  ds: string;
  title: string;
  /** Registry key that stores the mode; null when the switch is a code chain. */
  key: string | null;
  options: DecisionOption[];
  /** The combined mode id, or null when there is nothing to combine. */
  combined: string | null;
  defaultMode: string;
  /** The comparison measurements shown next to the switch. */
  measurements: string[];
  tasks: string[];
  notes?: string;
}

const option = (
  id: string,
  summary: string,
  pros: string[],
  cons: string[],
  requires?: string[],
): DecisionOption => (requires === undefined ? { id, summary, pros, cons } : { id, summary, pros, cons, requires });

export const DECISIONS: readonly DecisionMeta[] = [
  {
    ds: "DS-01",
    title: "Rekordbox live source",
    key: "live.provider",
    options: [
      option("rkbx-osc", "rkbx_link sidecar over OSC", ["richest timing and metadata"], ["needs the sidecar on the machine"], ["rkbx_link detected on its OSC port"]),
      option("lighting-ipc", "decoded SoundSwitch Lighting protocol", ["high rate, no sidecar"], ["undocumented protocol surface"]),
      option("prolink", "PRO DJ LINK packets", ["network native, no software hook"], ["players only, limited metadata"]),
      option("ax", "accessibility scrape of the DJ software", ["always available on macOS"], ["coarse timing"]),
      option("composite-flx4", "library id plus FLX4 plus Link plus audio correction", ["works with no software hook"], ["needs the controller and audio"]),
      option("memory-cleanroom", "our own reader of the software's memory", ["no sidecar"], ["version fragile"]),
      option("os2l", "OS2L beat input", ["simple and robust"], ["beat only, no track state"]),
    ],
    combined: "fusion",
    defaultMode: "fusion",
    measurements: ["per source: update rate", "beat error against the chosen authority", "state age", "fields provided", "dropouts"],
    tasks: ["T-LIVE-02", "T-LIVE-11"],
  },
  {
    ds: "DS-02",
    title: "Govee LAN stream engine",
    key: "govee.lan.engine",
    options: [
      option("toolkit", "govee-toolkit napi binding", ["fast, prebuilt"], ["native addon must load"], ["the toolkit addon present"]),
      option("native-ts", "our TypeScript codec on our sockets", ["no native dependency"], ["slower for large venues"]),
    ],
    combined: "auto",
    defaultMode: "auto",
    measurements: ["frames sent", "superseded frames", "send time", "errors per engine"],
    tasks: ["T-GOV-01", "T-GOV-03"],
  },
  {
    ds: "DS-03",
    title: "Transport failover",
    key: "govee.failover.policy",
    options: [
      option("strict", "explicit per-fixture mode list, never switches", ["predictable"], ["a broken transport takes the fixture dark"]),
      option("auto", "fastest verified transport for everything", ["resilient"], ["can land on a lower-quality transport silently"]),
    ],
    combined: "hybrid",
    defaultMode: "hybrid",
    measurements: ["time to failover", "frames lost", "transport per fixture"],
    tasks: ["T-FOV-01", "T-FOV-02"],
  },
  {
    ds: "DS-04",
    title: "BLE backend",
    key: "govee.ble.backend",
    options: [
      option("toolkit-ble", "btleplug inside govee-toolkit", ["shared native stack"], ["addon must load"]),
      option("noble", "@stoprocent/noble with our codec", ["no toolkit dependency"], ["platform differences in the backend"]),
    ],
    combined: "auto",
    defaultMode: "auto",
    measurements: ["connect time", "write success", "pacing adherence"],
    tasks: ["T-BLE-01"],
  },
  {
    ds: "DS-05",
    title: "BLE encrypted link",
    key: "govee.ble.encryptedLink",
    options: [
      option("off", "plain BLE frames", ["simplest path"], ["fails on devices that require the handshake"]),
      option("on", "always attempt the handshake", ["works once keys ship"], ["slower connect on plain devices"]),
    ],
    combined: "auto",
    defaultMode: "auto",
    measurements: ["handshake success per device"],
    tasks: ["T-BLE-07"],
    notes: "The owner confirms shipping keys before the handshake is enabled for all devices.",
  },
  {
    ds: "DS-06",
    title: "Storage driver",
    key: "storage.driver",
    options: [
      option("better-sqlite3", "native SQLite driver (spec 80)", ["fastest synchronous writes"], ["native module must load"]),
      option("node-sqlite", "built-in node:sqlite", ["no native module"], ["fewer features, different API"]),
    ],
    combined: "auto",
    defaultMode: "auto",
    measurements: ["open time", "write latency p99"],
    tasks: ["T-DATA-01"],
  },
  {
    ds: "DS-07",
    title: "Show host placement",
    key: "runtime.host",
    options: [
      option("worker-thread", "Node worker thread in main (spec 56)", ["simple lifetime", "fast message passing"], ["shares the main process heap"]),
      option("utility-process", "Electron utilityProcess", ["isolated crash domain"], ["higher message latency"]),
    ],
    combined: "utility-process-worker",
    defaultMode: "worker-thread",
    measurements: ["tick jitter under main-process load", "tick jitter while the renderer is frozen"],
    tasks: ["T-ARC-01"],
  },
  {
    ds: "DS-08",
    title: "Clock timer strategy",
    key: "runtime.clock.timerStrategy",
    options: [
      option("interval", "drift-corrected setInterval", ["low CPU"], ["coarse jitter"]),
      option("timeout-spin", "setTimeout plus busy-wait tail", ["tight jitter"], ["burns CPU in the tail"]),
    ],
    combined: "hybrid",
    defaultMode: "hybrid",
    measurements: ["tick jitter p50", "p99", "max", "CPU percent"],
    tasks: ["T-ARC-06"],
    notes: "The combined mode sleeps coarse with Atomics.wait and spins for runtime.clock.spinWindowMs.",
  },
  {
    ds: "DS-09",
    title: "Colour blend space",
    key: "mixer.blendSpace",
    options: [
      option("oklab", "blend in OKLab", ["perceptually even hue mixes"], ["lightness mixes less predictably"]),
      option("linear-rgb", "blend in linear light", ["physically correct energy"], ["hue can drift through grey"]),
      option("srgb-legacy", "blend the sRGB bytes (comparison only)", ["matches naive implementations"], ["darkens and desaturates midpoints"]),
    ],
    combined: "oklab-hue-linear-intensity",
    defaultMode: "oklab-hue-linear-intensity",
    measurements: ["visual A/B in the Inspector audition"],
    tasks: ["T-MIX-02", "T-REND-03"],
  },
  {
    ds: "DS-10",
    title: "Stems",
    key: "analysis.stems.mode",
    options: [
      option("allinone-stems", "real source separation", ["accurate stem energy"], ["slow, heavy"]),
      option("band-proxies", "filter-band proxies", ["fast, always available"], ["approximate bass, drums and vocals"]),
    ],
    combined: "fusion",
    defaultMode: "fusion",
    measurements: ["per-track readiness", "analysis time"],
    tasks: ["T-ANA-06"],
  },
  {
    ds: "DS-11",
    title: "Structure source weighting",
    key: "analysis.structure.mode",
    options: [
      option("pssi-first", "trust the native phrase and section index", ["matches what the DJ sees"], ["depends on analysis in the DJ software"]),
      option("ml-first", "trust the ML structure model", ["works without native analysis"], ["section labels can disagree with the track"]),
    ],
    combined: "fused",
    defaultMode: "fused",
    measurements: ["section agreement statistics on the validation set"],
    tasks: ["T-ANA-11"],
  },
  {
    ds: "DS-12",
    title: "Metrical cross-check",
    key: "analysis.metrical.mode",
    options: [
      option("beat-this", "beat_this model grid", ["strong on four-to-the-floor"], ["model weight to ship"]),
      option("allinone-beats", "allinone beat grid", ["same runtime as the other analysis"], ["weaker on odd meters"]),
    ],
    combined: "both",
    defaultMode: "both",
    measurements: ["grid warning rate"],
    tasks: ["T-ANA-07"],
  },
  {
    ds: "DS-13",
    title: "FLX4 MIDI backend",
    key: "flx4.backend",
    options: [
      option("native", "@julusian/midi in main", ["lowest latency"], ["one client per port on Windows"]),
      option("webmidi", "WebMIDI in the renderer", ["no native module"], ["tied to the renderer lifetime"]),
      option("windows-midi-services", "multi-client Windows MIDI", ["several apps can read the controller"], ["Windows only"]),
    ],
    combined: "auto",
    defaultMode: "auto",
    measurements: ["open success", "event latency"],
    tasks: ["T-FLX-01"],
  },
  {
    ds: "DS-14",
    title: "Live audio capture host",
    key: "audio.capture.host",
    options: [
      option("renderer", "WebAudio in the Live window", ["no extra window"], ["capture dies with a UI reload"]),
      option("audio-window", "hidden dedicated capture window", ["survives UI reloads"], ["one more window to manage"]),
    ],
    combined: "audio-window-with-renderer-fallback",
    defaultMode: "audio-window",
    measurements: ["survives a UI reload", "CPU"],
    tasks: ["T-AUD-01"],
  },
  {
    ds: "DS-15",
    title: "Rekordbox library reader",
    key: "library.rekordbox.reader",
    options: [
      option("rekordbox-connect", "TypeScript reader", ["no sidecar for the library"], ["needs the schema work"]),
      option("pyrekordbox", "uv sidecar", ["battle-tested parsing"], ["a Python runtime next to the app"]),
    ],
    combined: "auto",
    defaultMode: "auto",
    measurements: ["row-count agreement", "read time"],
    tasks: ["T-RBL-01"],
  },
  {
    ds: "DS-16",
    title: "Discovery rungs",
    key: null,
    options: [
      option("multicast", "govee.lan.discovery.multicast", ["finds devices that answer multicast"], ["some networks filter it"]),
      option("per-interface-broadcast", "govee.lan.discovery.perInterfaceBroadcast", ["works with several NICs"], ["more traffic"]),
      option("global-broadcast", "govee.lan.discovery.globalBroadcast", ["catches devices on other subnets"], ["noisy on large networks"]),
      option("scan-list", "govee.lan.discovery.scanList addresses", ["explicit and deterministic"], ["manual upkeep"]),
    ],
    combined: "all enabled",
    defaultMode: "all enabled",
    measurements: ["which rung found each device"],
    tasks: ["T-GOV-05"],
    notes: "Each rung is its own boolean key rather than one enum value.",
  },
  {
    ds: "DS-17",
    title: "Latency compensation",
    key: "render.latency.mode",
    options: [
      option("measured", "qualified per unit", ["exact alignment"], ["requires the qualification wizard"]),
      option("sku-default", "per-SKU default", ["works out of the box"], ["visible spread across units"]),
    ],
    combined: "measured-else-sku",
    defaultMode: "measured-else-sku",
    measurements: ["visible spread on camera"],
    tasks: ["T-REND-04"],
  },
  {
    ds: "DS-18",
    title: "Transition blackout translation",
    key: "mixer.blackout.policy",
    options: [
      option("full", "keep the blackout as programmed", ["maximum contrast at the drop"], ["blinds the room to the other deck"]),
      option("deck-spatial-dip", "dip the firing deck's own spatial region", ["keeps the room alive"], ["less dramatic"]),
      option("deck-side-blackout", "black out the firing deck's side of the room", ["full contrast where that deck lives"], ["needs the room splits"]),
      option("global-partial-dip", "dip the whole room", ["simplest translation"], ["dims the other deck too"]),
    ],
    combined: "auto",
    defaultMode: "auto",
    measurements: ["count of translations per set"],
    tasks: ["T-MIX-04"],
  },
  {
    ds: "DS-19",
    title: "Planner mode",
    key: "planner.mode",
    options: [
      option("rules", "deterministic rules", ["predictable and explainable"], ["cannot reject a pathological section"]),
      option("scored", "rule candidates chosen by evaluators", ["better plans"], ["needs the evaluator library"]),
    ],
    combined: "rules-with-veto",
    defaultMode: "rules-with-veto",
    measurements: ["diagnostics per mode on the validation set"],
    tasks: ["T-PLAN-12"],
  },
  {
    ds: "DS-20",
    title: "Segment resolution per device",
    key: null,
    options: [
      option("logical", "one logical segment stream", ["smooth motion"], ["many packets for large devices"]),
      option("grouped", "coarse segments", ["low packet count"], ["visible stepping"]),
      option("native", "the device's own resolution", ["best fidelity"], ["may not hold the target fps"]),
    ],
    combined: "auto",
    defaultMode: "auto",
    measurements: ["stable fps per resolution"],
    tasks: ["T-GOV-15"],
    notes: "Resolution is negotiated per device from the qualified rate (spec 53).",
  },
  {
    ds: "DS-21",
    title: "Single-zone rendering",
    key: "render.singleZone.representative",
    options: [
      option("mean-linear", "mean in linear light", ["physically correct"], ["dark cells drag the average down"]),
      option("area-weighted-mean-oklab", "area-weighted mean in OKLab", ["perceptually even"], ["slower"]),
      option("dominant", "the dominant colour", ["punchy"], ["loses the mix"]),
      option("center-cell", "the centre cell", ["cheap and stable"], ["ignores the rest of the fixture"]),
    ],
    combined: "area-weighted-mean-oklab",
    defaultMode: "area-weighted-mean-oklab",
    measurements: ["owner visual review"],
    tasks: ["T-FOV-03"],
  },
  {
    ds: "DS-22",
    title: "Rekordbox track identity on load",
    key: null,
    options: [
      option("memory-reader", "identity read from the software's memory", ["exact when it works"], ["version fragile"]),
      option("lighting-ipc", "identity from the Lighting IPC stream", ["exact, no reader"], ["needs SoundSwitch"]),
      option("agent-api", "Rekordbox agent API lookup", ["stable"], ["one more process"]),
      option("history-table", "the software's play history table", ["no runtime hook"], ["lagging"]),
      option("title-path-match", "title and path match against the library", ["always possible"], ["ambiguous with duplicate titles"]),
    ],
    combined: "resolver-chain",
    defaultMode: "resolver-chain",
    measurements: ["the Resolver tab shows which link resolved"],
    tasks: ["T-RBL-07"],
    notes: "The chain order is the option order; confidence gates a link before the next one runs.",
  },
  {
    ds: "DS-23",
    title: "Adaptive fallback clock",
    key: null,
    options: [
      option("dj-bpm", "last known BPM and phase", ["always available"], ["drifts while the source is lost"]),
      option("audio-onset", "live tempo from the audio onset detector", ["tracks the real music"], ["needs the audio capture path"]),
    ],
    combined: "blend",
    defaultMode: "blend",
    measurements: ["beat error when the source is lost"],
    tasks: ["T-RUN-06"],
  },
  {
    ds: "DS-24",
    title: "Room distance metric for pulses",
    key: "room.distanceMetric",
    options: [
      option("euclidean", "straight-line distance", ["cheap and smooth"], ["cuts through walls"]),
      option("perimeter-geodesic", "distance along the room perimeter", ["follows the room"], ["slower"]),
      option("angular", "distance as seen from the DJ", ["natural for sweeps"], ["stretches long rooms"]),
    ],
    combined: "auto",
    defaultMode: "auto",
    measurements: ["visual review"],
    tasks: ["T-ROOM-05"],
  },
  {
    ds: "DS-25",
    title: "Perimeter zero point",
    key: "room.perimeter.zero",
    options: [
      option("dj-nearest", "the point nearest the DJ", ["matches where the DJ stands"], ["moves if the booth moves"]),
      option("front-center", "the front of the room", ["stable"], ["may not match the booth"]),
      option("controller", "the controller's own position", ["explicit"], ["needs the room drawing"]),
      option("custom-anchor", "a named anchor", ["fully explicit"], ["manual upkeep"]),
    ],
    combined: null,
    defaultMode: "dj-nearest",
    measurements: ["not applicable: a pure choice"],
    tasks: ["T-ROOM-05"],
  },
  {
    ds: "DS-26",
    title: "Crossfader curve source",
    key: null,
    options: [
      option("software", "the DJ software's own crossfader value", ["matches what the DJ hears"], ["not every source exposes it"]),
      option("controller", "the FLX4 hardware value", ["works with no software hook"], ["independent of the software's curve"]),
      option("configured", "the configured curve and assignment", ["fully predictable"], ["drifts from the real mixer"]),
    ],
    combined: "auto",
    defaultMode: "auto",
    measurements: ["agreement between the sources"],
    tasks: ["T-MIX-01"],
    notes: "mixer.crossfader.curve selects the curve shape; the DS-26 rung is resolved by the mixer in the order software, controller, configured.",
  },
  {
    ds: "DS-27",
    title: "White hit rendering on RGBWW fixtures",
    key: null,
    options: [
      option("rgb-white", "white from the RGB channels (spec 48)", ["never disarms the stream"], ["uses no dedicated white emitter"]),
      option("white-channel", "the fixture's white channel", ["brighter on some units"], ["the stream test must prove it does not disarm"]),
    ],
    combined: "rgb-white-unless-qualified",
    defaultMode: "rgb-white",
    measurements: ["stream survival test"],
    tasks: ["T-GOV-09"],
    notes: "Per unit: qualification may prove the white channel safe for that fixture alone.",
  },
  {
    ds: "DS-28",
    title: "Adaptive director engine",
    key: "runtime.adaptive.engine",
    options: [
      option("rules", "phrase look library chosen by rules", ["coherent and testable"], ["ignores the audio"]),
      option("audio-informed", "energy and onset driven looks", ["reacts to the room"], ["can chase noise"]),
    ],
    combined: "combined",
    defaultMode: "combined",
    measurements: ["look change rate against phrase boundaries"],
    tasks: ["T-RUN-09"],
  },
  {
    ds: "DS-29",
    title: "ProLink participation",
    key: "live.prolink.mode",
    options: [
      option("passive", "listen only", ["never disturbs the players"], ["no discovery from the player side"]),
      option("virtual-cdj", "announce as a player", ["players push state to us"], ["device-number collisions take a player offline"]),
    ],
    combined: "auto",
    defaultMode: "passive",
    measurements: ["packets seen", "collisions"],
    tasks: ["T-LIVE-05"],
  },
  {
    ds: "DS-30",
    title: "Packaging tool",
    key: null,
    options: [
      option("electron-builder", "electron-builder, recorded in ADR-006", ["macOS and Windows targets from one config"], ["build-time only"]),
    ],
    combined: null,
    defaultMode: "electron-builder",
    measurements: ["not applicable: chosen at build time"],
    tasks: ["T-OPS-05"],
    notes: "Build-time only: an app cannot switch its own installer, so this switch has no runtime mode.",
  },
  {
    ds: "DS-31",
    title: "Per-device transport mode",
    key: "govee.device.<fixtureId>.transportMode",
    options: [
      option("lan-segmented", "segmented LAN frames", ["per-cell motion"], ["many packets"]),
      option("lan-basic", "whole-fixture LAN colour", ["cheap"], ["no per-cell motion"]),
      option("ble-segmented", "segmented BLE frames", ["works without LAN"], ["pacing limits"]),
      option("ble-basic", "whole-fixture BLE colour", ["simple"], ["scales badly with many devices"]),
      option("matter-basic", "Matter colour control", ["standards based"], ["round-trip latency, no segmentation"]),
      option("cloud-basic", "cloud colour control", ["works off-network"], ["never carries frames and is never used for beat-critical output"]),
    ],
    combined: "hybrid",
    defaultMode: "hybrid",
    measurements: ["effective transport", "frames sent per transport", "switch count", "time on a degraded transport"],
    tasks: ["T-FOV-01", "T-FOV-02"],
  },
  {
    ds: "DS-32",
    title: "Perimeter orbit path between two points",
    key: "room.orbit.path",
    options: [
      option("shortest", "fewest cells along the loop", ["fast travel"], ["direction flips between moves"]),
      option("directed", "always follow the perimeter direction", ["stable orientation"], ["long way round"]),
    ],
    combined: "auto",
    defaultMode: "auto",
    measurements: ["visual review"],
    tasks: ["T-ROOM-05", "T-ROOM-07"],
  },
  {
    ds: "DS-33",
    title: "Spatial split side assignment",
    key: "room.splits.mode",
    options: [
      option("signed-distance", "continuous side of a drawn split line", ["smooth assignment"], ["needs the room drawing"]),
      option("group-membership", "explicit group lists", ["fully predictable"], ["manual upkeep per fixture"]),
    ],
    combined: "blend",
    defaultMode: "blend",
    measurements: ["visual review"],
    tasks: ["T-ROOM-06"],
  },
  {
    ds: "DS-34",
    title: "Track fingerprint",
    key: "identity.fingerprint.mode",
    options: [
      option("pcm-hash", "exact hash of the canonical decode", ["no false links"], ["misses re-encodes"]),
      option("acoustic", "Chromaprint-style similarity", ["links re-encodes and different masters"], ["threshold tuning, can mis-link"]),
    ],
    combined: "both",
    defaultMode: "both",
    measurements: ["match counts", "false-link reports"],
    tasks: ["T-ID-01"],
  },
  {
    ds: "DS-35",
    title: "Library watcher engine",
    key: "library.watch.engine",
    options: [
      option("native-events", "@parcel/watcher filesystem events", ["instant detection"], ["platform quirks"]),
      option("polling", "stat sweep", ["works everywhere"], ["slow and CPU heavy"]),
    ],
    combined: "auto",
    defaultMode: "auto",
    measurements: ["missed-change counter", "CPU"],
    tasks: ["T-RBL-06", "T-SER-04"],
  },
  {
    ds: "DS-36",
    title: "Ableton Link integration",
    key: "live.link.mode",
    options: [
      option("sidecar", "user-installed bridge process over a local socket", ["no proprietary license needed"], ["one more process to install"]),
      option("sdk", "the linked SDK", ["tightest integration"], ["requires Ableton's proprietary license"]),
    ],
    combined: "auto",
    defaultMode: "auto",
    measurements: ["tempo and phase agreement with other sources"],
    tasks: ["T-LIVE-12"],
  },
];

const byDs = new Map(DECISIONS.map((d) => [d.ds, d]));
const byKey = new Map(
  DECISIONS.filter((d): d is DecisionMeta & { key: string } => d.key !== null).map((d) => [d.key, d]),
);

export function decisionFor(ds: string): DecisionMeta {
  const found = byDs.get(ds);
  if (found === undefined) throw new Error(`unknown-decision: ${ds}`);
  return found;
}

export function decisionForConfigKey(key: string): DecisionMeta | null {
  return byKey.get(key) ?? null;
}

export const DECISION_IDS: readonly string[] = DECISIONS.map((d) => d.ds);

/** Mode ids an interface may offer for a switch, in catalog order. */
export function decisionModes(ds: string): string[] {
  const meta = decisionFor(ds);
  const ids = meta.options.map((o) => o.id);
  return meta.combined === null || ids.includes(meta.combined) ? ids : [...ids, meta.combined];
}

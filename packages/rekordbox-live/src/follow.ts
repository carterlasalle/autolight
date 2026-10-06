// Browser-safe follow helpers (T-TRU-04 spine fix).
//
// Pure math over provider readings plus the rkbx_link config checks: no
// sockets, no node: imports. These used to live in the package barrel
// (follow math) and in rkbx-osc.ts (config checks next to the UDP provider),
// so any renderer import dragged node:dgram into the browser bundle and
// blank-screened `yarn dev`. The renderer imports this module directly; the
// barrel re-exports it so existing main-process imports keep resolving.
// Ownership rule `ownership-provider-io-main-only` stays green: this file
// owns no I/O.
import { axFractionalBeat } from "./ax.js";

// Time field. Main process polls Rekordbox's AX tree (~1Hz); this maps
// elapsed seconds onto the ANLZ grid and reports permission state honestly.
// Accuracy ±1 beat. `readable: false` means AX denied/empty → caller holds
// preview instead of guessing.
export interface AxBeatSample {
  deckId: number;
  elapsedSeconds: number | null;
  playing: boolean | null;
  readable: boolean;
  sampledAtNs: bigint;
}

export function axBeatToPlayhead(sample: AxBeatSample, grid: { sourceTimeMs: number }[]): number | null {
  if (!sample.readable || sample.elapsedSeconds === null) return null;
  return axFractionalBeat(sample.elapsedSeconds, grid);
}

export type FollowSource = "preview" | "ax-beat" | "prolink";

// Combined transport: prolink beats win when a peer emits, AX elapsed wins
// when readable, otherwise the estimator coasts the last known beat at grid
// tempo. Never fabricates: `beat: null` means unknown, UI holds preview.
export interface CombinedTransport {
  source: FollowSource;
  beat: number | null;
  playing: boolean | null;
  bpm: number | null;
}

export function combineTransport(opts: {
  prolink: { beat: number | null; playing: boolean | null; bpm: number | null; peerPresent: boolean };
  ax: { beat: number | null; playing: boolean | null };
  estimatedBeat: number | null;
  estimatedBpm: number | null;
}): CombinedTransport {
  if (opts.prolink.peerPresent && opts.prolink.beat !== null) {
    return { source: "prolink", beat: opts.prolink.beat, playing: opts.prolink.playing, bpm: opts.prolink.bpm ?? opts.estimatedBpm };
  }
  if (opts.ax.beat !== null) {
    return { source: "ax-beat", beat: opts.ax.beat, playing: opts.ax.playing, bpm: opts.estimatedBpm };
  }
  return { source: "preview", beat: opts.estimatedBeat, playing: null, bpm: opts.estimatedBpm };
}

// rkbx_link OSC surface moved verbatim from rkbx-osc.ts (only the socket
// provider stays there): address parse, tolerant config reader, and the
// T-LIVE-04 setup verification. Pure string logic, browser-safe.
export interface RkbxAddress {
  deck: number | "master";
  path: string;
  subdiv: number | null;
}

// `/<deck>/<path...>` with unknown paths retained verbatim.
export function parseRkbxAddress(address: string): RkbxAddress | null {
  const parts = address.split("/").filter((p) => p.length > 0);
  const deckToken = parts[0];
  if (deckToken === undefined) return null;
  const deck = deckToken === "master" ? "master" : /^[1-4]$/.test(deckToken) ? Number(deckToken) : null;
  if (deck === null) return null;
  const rest = parts.slice(1).join("/");
  const subdiv = /^beat\/subdiv\/(\d+)$/.exec(rest);
  return { deck, path: rest, subdiv: subdiv ? Number(subdiv[1]) : null };
}

// Tolerant reader for the user's rkbx_link config file: it reports the OSC
// lines it finds and never guesses at a format it does not recognize.
export interface RkbxConfigProbe {
  lines: string[];
  oscEnabled: boolean | null;
  destination: string | null;
}

export function parseRkbxOscConfig(text: string): RkbxConfigProbe {
  const lines: string[] = [];
  let oscEnabled: boolean | null = null;
  let destination: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!/osc/i.test(line)) continue;
    lines.push(line);
    const enabled = /osc[a-z_-]*\s*[:=]\s*(true|false|1|0|yes|no|on|off)\b/i.exec(line);
    if (enabled) oscEnabled = /true|1|yes|on/i.test(enabled[1] ?? "");
    const dest = /((?:\d{1,3}\.){3}\d{1,3}:\d{2,5})/.exec(line);
    if (dest) destination = dest[1] ?? null;
  }
  return { lines, oscEnabled, destination };
}

export interface RkbxSetupInput {
  configFound: boolean;
  config: RkbxConfigProbe;
  expectedDestination: string;
  installedRekordboxVersion: string;
  supportedVersions: readonly string[];
  packetsReceived: number;
  lastAddress: string | null;
}

export interface RkbxSetupStep {
  id: string;
  ok: boolean;
  detail: string;
}

export interface RkbxSetupReport {
  state: "receiving" | "no-packets" | "not-installed" | "osc-disabled" | "wrong-destination" | "unsupported-version";
  steps: RkbxSetupStep[];
  remedy: string;
}

// T-LIVE-04 verification half: the assistant shows the owner what to do and
// verifies the result; it never re-signs, never uses sudo, never downloads.
export function checkRkbxSetup(input: RkbxSetupInput): RkbxSetupReport {
  const steps: RkbxSetupStep[] = [];
  const installed = input.configFound;
  steps.push({
    id: "installed",
    ok: installed,
    detail: installed
      ? "rkbx_link folder selected (live.rkbx.configPath)"
      : "no rkbx_link folder selected: point live.rkbx.configPath at your rkbx_link install",
  });
  const oscEnabled = input.config.oscEnabled === true;
  steps.push({
    id: "osc-enabled",
    ok: oscEnabled,
    detail: oscEnabled
      ? "OSC output is enabled in the rkbx_link config"
      : `OSC output not seen in ${input.config.lines.length} OSC line(s) of the config; enable OSC output`,
  });
  const destinationOk = input.config.destination === input.expectedDestination;
  steps.push({
    id: "destination",
    ok: destinationOk,
    detail: destinationOk
      ? `OSC destination matches ${input.expectedDestination} (live.rkbx.oscBind)`
      : `OSC destination is ${input.config.destination ?? "not found"}, expected ${input.expectedDestination}`,
  });
  const versionOk = input.supportedVersions.includes(input.installedRekordboxVersion);
  steps.push({
    id: "version",
    ok: versionOk,
    detail: versionOk
      ? `Rekordbox ${input.installedRekordboxVersion} has community offsets for rkbx_link on this OS`
      : `Rekordbox ${input.installedRekordboxVersion} is not a version rkbx_link supports here (re-sign and sudo consequences apply to a version change)`,
  });
  const receiving = input.packetsReceived > 0;
  steps.push({
    id: "receiving",
    ok: receiving,
    detail: receiving
      ? `${input.packetsReceived} packets; last address ${input.lastAddress ?? "unknown"}`
      : "no OSC packets received yet on the bound port",
  });
  const failed = steps.find((s) => !s.ok);
  if (!failed) return { state: "receiving", steps, remedy: "" };
  const state: RkbxSetupReport["state"] =
    failed.id === "installed" ? "not-installed"
    : failed.id === "osc-enabled" ? "osc-disabled"
    : failed.id === "destination" ? "wrong-destination"
    : failed.id === "version" ? "unsupported-version"
    : "no-packets";
  return { state, steps, remedy: failed.detail };
}

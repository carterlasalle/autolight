// rkbx_link setup assistant (T-LIVE-04, F-LIVE-03 setup part).
//
// This module is the presentation-facing half of the assistant. The checking
// logic lives in rkbx-osc.ts (parseRkbxOscConfig, checkRkbxSetup) and is
// reused here, not reimplemented. This file adds the version support table,
// the packet sample helper, the plain-words re-sign and sudo copy with the
// project link, and the capability mapping the panel renders.
//
// Hard boundary: this module only reads the user-selected config text it is
// handed and only observes provider counters. It never re-signs Rekordbox,
// never elevates, and never retrieves the sidecar. There is intentionally no
// import in this file beyond the checking helpers, so no privileged action
// is even reachable from here.
import {
  checkRkbxSetup,
  parseRkbxOscConfig,
  type RkbxSetupReport,
} from "./follow.js";

export const RKBX_LINK_PROJECT_URL = "https://github.com/grufkork/rkbx_link";

export const RKBX_DEFAULT_DESTINATION = "127.0.0.1:4460";

export type RkbxPlatform = "macos" | "windows";

// Community offsets reported for rkbx_link (F-LIVE-16, OD-01): macOS Apple
// Silicon covers 7.2.8, 7.2.17 and 7.2.18. Windows covers 7.2.10 through a
// paid rkbx_link license. Anything else is unsupported until proven.
export const RKBX_MACOS_VERSIONS: readonly string[] = ["7.2.8", "7.2.17", "7.2.18"];
export const RKBX_WINDOWS_VERSIONS: readonly string[] = ["7.2.10"];

// Prefix match so build tags like 7.2.10.0333 match their 7.2.10 entry.
export function isRKBXVersionSupported(version: string, platform: RkbxPlatform): boolean {
  const trimmed = version.trim();
  if (trimmed.length === 0) return false;
  const supported = platform === "windows" ? RKBX_WINDOWS_VERSIONS : RKBX_MACOS_VERSIONS;
  return supported.some((prefix) => trimmed.startsWith(prefix));
}

export const RKBX_OS_NOTES: Record<RkbxPlatform, string> = {
  windows: "Windows with a paid rkbx_link license covers Rekordbox 7.2.10.",
  macos: "macOS community offsets cover Rekordbox 7.2.8, 7.2.17 and 7.2.18 on Apple Silicon. Rekordbox 7.2.10 on macOS is not covered.",
};

// Plain-words consequences shown next to the steps, always with the link.
export const RKBX_RESIGN_COPY =
  "Re-signing replaces Rekordbox's official signature with a local one so the sidecar can read its memory. " +
  "macOS may then warn about the signature, and every Rekordbox update needs the re-sign done again.";

export const RKBX_SUDO_COPY =
  "The sidecar asks to run as an administrator (sudo) so it can read another app's memory. " +
  "While it runs that way it has full control of the machine. That choice is yours: " +
  "this app never runs the re-sign script, never asks for sudo, and never fetches rkbx_link for you. " +
  "It only reads the config folder you point it at and checks that packets arrive.";

export interface RkbxPacketSample {
  received: number;
  updateHz: number;
  lastAddress: string | null;
}

export interface RkbxAssistantInput {
  // Value of live.rkbx.configPath: the user's rkbx_link folder. Empty means none selected.
  configPath: string;
  // Full text of the rkbx_link config file, or null when the folder has none to read.
  configText: string | null;
  expectedDestination?: string;
  installedVersion: string;
  platform: RkbxPlatform;
  packets: RkbxPacketSample;
}

export type RkbxAssistantCapability = "PASS" | "UNAVAILABLE_ON_THIS_DEVICE" | "MISSING";

export interface RkbxAssistantSnapshot {
  configPath: string;
  configFound: boolean;
  oscEnabled: boolean | null;
  destination: string | null;
  expectedDestination: string;
  installedVersion: string;
  platform: RkbxPlatform;
  supportedVersions: readonly string[];
  packets: RkbxPacketSample;
  report: RkbxSetupReport;
  capability: RkbxAssistantCapability;
}

export function assistantCapability(report: RkbxSetupReport): RkbxAssistantCapability {
  if (report.state === "receiving") return "PASS";
  if (report.state === "unsupported-version") return "UNAVAILABLE_ON_THIS_DEVICE";
  return "MISSING";
}

export function summarizeRKBXAssistant(input: RkbxAssistantInput): RkbxAssistantSnapshot {
  const configPath = input.configPath.trim();
  const configFound = configPath.length > 0 && input.configText !== null;
  const probe = parseRkbxOscConfig(input.configText ?? "");
  const expectedDestination = input.expectedDestination ?? RKBX_DEFAULT_DESTINATION;
  const supportedVersions = input.platform === "windows" ? RKBX_WINDOWS_VERSIONS : RKBX_MACOS_VERSIONS;
  const installed = input.installedVersion.trim();
  const prefix = supportedVersions.find((entry) => installed.startsWith(entry));
  const report = checkRkbxSetup({
    configFound,
    config: probe,
    expectedDestination,
    installedRekordboxVersion: prefix ?? installed,
    supportedVersions,
    packetsReceived: input.packets.received,
    lastAddress: input.packets.lastAddress,
  });
  return {
    configPath,
    configFound,
    oscEnabled: probe.oscEnabled,
    destination: probe.destination,
    expectedDestination,
    installedVersion: input.installedVersion,
    platform: input.platform,
    supportedVersions,
    packets: { ...input.packets },
    report,
    capability: assistantCapability(report),
  };
}

// Build the packet half of the input from a live provider: arrival rate from
// its status, totals from its counters, last address from the provider.
export function sampleFromProvider(
  status: { state: string; updateHz?: number },
  stats: { received: number },
  lastAddress: string | null,
): RkbxPacketSample {
  return {
    received: stats.received,
    updateHz: status.state === "live" && typeof status.updateHz === "number" ? status.updateHz : 0,
    lastAddress,
  };
}

// Version registry, qualification records and the unverified banner
// (T-LIVE-13, F-LIVE-08, spec 145, spec 146).
//
// `RekordboxProtocolDefinition` per provider: versionRange, platform,
// decoder id, fixture set, qualification record (date, machine, runbook,
// results). Replaces the string-prefix `isSupported` check: the registry
// reports `qualified`, `unverified` (probing allowed, not declared
// supported) or `unsupported` per provider for the running Rekordbox
// version (macOS bundle Info.plist, Windows file version).
//
// `UNVERIFIED REKORDBOX VERSION` appears in the status bar and on the
// source badge, never as a modal during Live (spec 144). The registry is
// generated from committed fixture metadata: a new fixture set flips a
// version to qualified only when the replay suite passes.
import { z } from "zod";
import type { ProviderId } from "./providers.js";

export type ProviderQualification = "qualified" | "unverified" | "unsupported";

export interface QualificationRecord {
  readonly date: string;
  readonly machine: string;
  readonly runbook: string;
  readonly result: "pass" | "fail";
  readonly notes: string;
}

export interface ProtocolDefinitionEntry {
  readonly provider: ProviderId;
  readonly versionRange: string;
  readonly platform: "macos" | "windows";
  readonly decoder: string;
  readonly fixtures: readonly string[];
  readonly qualification: QualificationRecord | null;
}

const qualificationSchema = z.object({
  date: z.string().min(1),
  machine: z.string().min(1),
  runbook: z.string().min(1),
  result: z.enum(["pass", "fail"]),
  notes: z.string(),
});

const definitionSchema = z.object({
  provider: z.string().min(1),
  versionRange: z.string().min(1),
  platform: z.enum(["macos", "windows"]),
  decoder: z.string().min(1),
  fixtures: z.array(z.string()),
  qualification: qualificationSchema.nullable(),
});

export type RegistryJson = z.infer<typeof registrySchema>;

const registrySchema = z.object({
  definitions: z.array(definitionSchema),
});

export function parseRegistry(raw: unknown): ProtocolDefinitionEntry[] {
  const parsed = registrySchema.parse(raw);
  return parsed.definitions.map((def) => ({
    provider: def.provider as ProviderId,
    versionRange: def.versionRange,
    platform: def.platform,
    decoder: def.decoder,
    fixtures: def.fixtures,
    qualification: def.qualification,
  }));
}

export function serializeRegistry(definitions: readonly ProtocolDefinitionEntry[]): RegistryJson {
  return {
    definitions: definitions.map((def) => ({
      provider: def.provider,
      versionRange: def.versionRange,
      platform: def.platform,
      decoder: def.decoder,
      fixtures: [...def.fixtures],
      qualification: def.qualification,
    })),
  };
}

// Prefix match on the range stem: "7.2.x" matches "7.2.19" and
// "7.2.19.0012" but not "7.3.0". Exact versions match exactly.
export function versionInRange(version: string, range: string): boolean {
  if (range.endsWith(".x")) {
    return version === range.slice(0, -2) || version.startsWith(range.slice(0, -1));
  }
  return version === range || version.startsWith(range + ".");
}

export function qualifyProvider(
  definitions: readonly ProtocolDefinitionEntry[],
  provider: ProviderId,
  version: string,
  platform: "macos" | "windows",
): { status: ProviderQualification; reason: string } {
  const candidates = definitions.filter((def) => def.provider === provider && def.platform === platform);
  const matching = candidates.find((def) => versionInRange(version, def.versionRange));
  if (!matching) {
    const known = candidates.map((def) => def.versionRange).join(", ");
    return {
      status: "unsupported",
      reason: known
        ? `${provider} has no entry for Rekordbox ${version} on ${platform} (known: ${known})`
        : `${provider} has no entries on ${platform} at all`,
    };
  }
  if (matching.qualification && matching.qualification.result === "pass") {
    return {
      status: "qualified",
      reason: `${provider} ${matching.versionRange} qualified ${matching.qualification.date} via ${matching.qualification.runbook}`,
    };
  }
  return {
    status: "unverified",
    reason: `UNVERIFIED REKORDBOX VERSION ${version}: ${provider} ${matching.versionRange} probed but not qualified`,
  };
}

export interface RegistryStatus {
  readonly provider: ProviderId;
  readonly status: ProviderQualification;
  readonly reason: string;
}

export function registryStatus(
  definitions: readonly ProtocolDefinitionEntry[],
  version: string,
  platform: "macos" | "windows",
): RegistryStatus[] {
  const providers = [...new Set(definitions.map((def) => def.provider))];
  return providers.map((provider) => ({ provider, ...qualifyProvider(definitions, provider, version, platform) }));
}

// Status bar and source badge text (spec 144, 145): a banner string when any
// provider is unverified on this version, null when all are qualified or
// unsupported. Never a modal during Live; the caller renders this inline.
export function unverifiedBanner(
  definitions: readonly ProtocolDefinitionEntry[],
  version: string,
  platform: "macos" | "windows",
): string | null {
  const pending = registryStatus(definitions, version, platform).filter((entry) => entry.status === "unverified");
  if (pending.length === 0) return null;
  return `UNVERIFIED REKORDBOX VERSION ${version} (${pending.map((entry) => entry.provider).join(", ")})`;
}

// Detect the running Rekordbox version: macOS bundle Info.plist text,
// Windows file version string. Pure functions over injected text so tests
// need no filesystem and no registry access.
export function detectMacosVersion(plist: string): string | null {
  const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
  const value = match?.[1]?.trim() ?? "";
  return value.length > 0 ? value : null;
}

export function detectWindowsVersion(fileVersion: string): string | null {
  const value = fileVersion.trim();
  return value.length > 0 ? value : null;
}

// Commit a qualification: a new fixture set flips a version to qualified
// only when the replay suite passes. Returns the updated definitions.
export function recordQualification(
  definitions: readonly ProtocolDefinitionEntry[],
  provider: ProviderId,
  versionRange: string,
  platform: "macos" | "windows",
  record: QualificationRecord,
  replayPassed: boolean,
): ProtocolDefinitionEntry[] {
  return definitions.map((def) => {
    if (def.provider !== provider || def.versionRange !== versionRange || def.platform !== platform) return def;
    if (!replayPassed) return { ...def, qualification: { ...record, result: "fail" as const } };
    return { ...def, qualification: { ...record, result: "pass" as const } };
  });
}

// Seed registry from the versions this plan documents: rkbx-osc community
// offsets, the prolink/AX transports, and the pending Lighting/memory rows
// that stay unverified until their captures land.
export function seedRegistry(): ProtocolDefinitionEntry[] {
  return [
    {
      provider: "lighting-ipc",
      versionRange: "7.2.x",
      platform: "macos",
      decoder: "lighting-container/v1",
      fixtures: [],
      qualification: null,
    },
    {
      provider: "memory-cleanroom",
      versionRange: "7.2.x",
      platform: "macos",
      decoder: "memory-cleanroom/v1",
      fixtures: [],
      qualification: null,
    },
    {
      provider: "rkbx-osc",
      versionRange: "7.2.x",
      platform: "macos",
      decoder: "rkbx-osc/v1",
      fixtures: ["protocol-fixtures/rekordbox/golden/osc-vectors.json"],
      qualification: null,
    },
    {
      provider: "prolink",
      versionRange: "7.2.x",
      platform: "macos",
      decoder: "prolink/v1",
      fixtures: ["protocol-fixtures/rekordbox/golden/prolink-vectors.json"],
      qualification: null,
    },
    {
      provider: "ax",
      versionRange: "7.2.x",
      platform: "macos",
      decoder: "ax/v1",
      fixtures: ["protocol-fixtures/rekordbox/ax/macos-tree.json"],
      qualification: null,
    },
    {
      provider: "os2l",
      versionRange: "7.2.x",
      platform: "macos",
      decoder: "os2l/v1",
      fixtures: [],
      qualification: null,
    },
  ];
}

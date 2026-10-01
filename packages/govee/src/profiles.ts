// Device profiles for our govee-toolkit fork (T-GOV-13, closes F-GOV-15;
// spec 42 to 45). `devices/H6076.yaml` and `devices/H1A45.yaml` are the
// defaults for new units of those SKUs, in the subset of the toolkit device
// schema our fork validates. Every number carries a receipt naming where it
// came from, and nothing here is a measurement of the owner's units: no unit
// has been qualified on hardware yet, so the loader refuses a profile whose
// receipts are missing and `unmeasured` is a value, not a gap. Profiles are
// defaults; the wizard (./qualification.ts) still measures every unit.
//
// Provenance: govee-toolkit MIT (Damien Thery, v0.5.0) `devices/schema.yaml`
// and `devices/H61A0.yaml` (field names), `docs/protocol/lan.md` sections 1
// and 2.3 (arm settle, rate ceilings, fold-back chains); Govee product
// material and the official Govee WLAN guide for SKU facts; vendor/govee-toolkit
// PIN.md for why the fork exists.
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

/** Where a profile number came from. `hardware-measured` is the only source
 *  that counts as a measurement of `unit` hardware; nothing in this repo has
 *  one yet. */
export type ProfileSource =
  | "unmeasured"
  | "product-material"
  | "toolkit-default"
  | "toolkit-measured-other-sku"
  | "sim-verified"
  | "hardware-measured";

const PROFILE_SOURCES: readonly string[] = [
  "unmeasured",
  "product-material",
  "toolkit-default",
  "toolkit-measured-other-sku",
  "sim-verified",
  "hardware-measured",
];

export interface Measured<T> {
  value: T | null;
  source: ProfileSource;
  /** Why this value is trustworthy, or what measures it per unit. Never
   *  empty: a receipt-less number is a claim, and a claim is not allowed. */
  receipt: string;
}

export interface DeviceProfile {
  schema: string;
  sku: string;
  name: string;
  family: string;
  /** Profiles are defaults for new units, never a substitute for the wizard. */
  qualificationRequired: true;
  /** Whole-fixture and segmented modes this SKU is expected to offer; the
   *  T-GOV-10 probe decides which one a unit actually has. */
  modes: string[];
  productMaterialSegments: Measured<number>;
  lengthMeters: Measured<number>;
  capabilities: {
    segmented: Measured<boolean>;
    lanRazer: Measured<boolean>;
    lanJsonControl: Measured<boolean>;
    ble: Measured<boolean>;
    matter: Measured<boolean>;
  };
  segmentChain: Measured<string>;
  nativePixelsPerMeter: Measured<number>;
  measurements: {
    armSettleMs: Measured<number>;
    fallbackHz: Measured<number>;
    maxHzByZones: Measured<Record<number, number>>;
    turnEndsChannel: Measured<boolean>;
    whiteEndsChannel: Measured<boolean>;
    answersStatusWhileArmed: Measured<boolean>;
  };
  /** Filled in by the loader: which file this profile came from. */
  file: string;
}

export interface DeviceCatalog {
  schema: string;
  /** Keyed by SKU; a catalog is small and fixed per release. */
  profiles: Map<string, DeviceProfile>;
}

// ---------------------------------------------------------------------------
// Minimal YAML subset
//
// The toolkit's device profiles are YAML, and this package has no YAML
// dependency. The subset here is exactly what devices/*.yaml uses: nested maps
// by two-space indentation, "- item" lists, `key: scalar` pairs, comments, and
// scalars (null, true, false, numbers, quoted and plain strings). Anything
// outside the subset throws instead of being guessed at.
// ---------------------------------------------------------------------------

export type YamlScalar = string | number | boolean | null;
export type YamlNode = YamlScalar | YamlNode[] | { [key: string]: YamlNode };

function parseScalar(text: string): YamlScalar {
  const trimmed = text.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "null" || trimmed === "~") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?[0-9]+(\.[0-9]+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

/** Parses the profile subset. Throws with the line number on anything the
 *  subset cannot express, so a malformed profile fails loudly. */
export function parseProfileYaml(text: string): { [key: string]: YamlNode } {
  const root: { [key: string]: YamlNode } = {};
  const stack: { indent: number; node: { [key: string]: YamlNode } | YamlNode[] }[] = [
    { indent: -1, node: root },
  ];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index] ?? "";
    const hash = raw.indexOf("#");
    const line = hash >= 0 ? raw.slice(0, hash) : raw;
    if (line.trim().length === 0) continue;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    while (stack.length > 1) {
      const top = stack[stack.length - 1];
      if (top === undefined || top.indent < indent) break;
      stack.pop();
    }
    const container = stack[stack.length - 1];
    if (container === undefined) throw new Error(`profile yaml: line ${index + 1}: no container`);
    if (body.startsWith("- ")) {
      if (!Array.isArray(container.node)) {
        throw new Error(`profile yaml: line ${index + 1}: list item outside a list`);
      }
      container.node.push(parseScalar(body.slice(2)));
      continue;
    }
    const separator = body.indexOf(":");
    if (separator <= 0) throw new Error(`profile yaml: line ${index + 1}: expected "key: value"`);
    const key = parseScalar(body.slice(0, separator).trim());
    if (typeof key !== "string") throw new Error(`profile yaml: line ${index + 1}: key must be text`);
    if (Array.isArray(container.node)) throw new Error(`profile yaml: line ${index + 1}: key inside a list`);
    const rest = body.slice(separator + 1).trim();
    if (rest.length > 0) {
      container.node[key] = parseScalar(rest);
      continue;
    }
    // "key:" with no value: the next non-empty line decides list or map.
    const child: { [key: string]: YamlNode } | YamlNode[] = nextIsList(lines, index + 1) ? [] : {};
    container.node[key] = child;
    stack.push({ indent, node: child });
  }
  return root;
}

function nextIsList(lines: readonly string[], from: number): boolean {
  for (let index = from; index < lines.length; index++) {
    const raw = lines[index] ?? "";
    const hash = raw.indexOf("#");
    const line = hash >= 0 ? raw.slice(0, hash) : raw;
    if (line.trim().length === 0) continue;
    return line.trim().startsWith("- ");
  }
  return false;
}

// ---------------------------------------------------------------------------
// Profile loading and lint (P-45-profiles)
// ---------------------------------------------------------------------------

function asMap(node: YamlNode | undefined, where: string): { [key: string]: YamlNode } {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    throw new Error(`profile: ${where} must be a map`);
  }
  return node;
}

function isProfileSource(value: string): value is ProfileSource {
  return PROFILE_SOURCES.includes(value);
}

function measured<T>(
  node: YamlNode | undefined,
  where: string,
  read: (value: YamlNode) => T | null,
): Measured<T> {
  const map = asMap(node, where);
  const source = map["source"];
  if (typeof source !== "string" || !isProfileSource(source)) {
    throw new Error(`profile: ${where}.source must be one of ${PROFILE_SOURCES.join(", ")}`);
  }
  const receipt = map["receipt"];
  if (typeof receipt !== "string" || receipt.trim().length === 0) {
    throw new Error(`profile: ${where}.receipt is required: every profile number names where it came from`);
  }
  const raw = map["value"];
  return { value: raw === undefined || raw === null ? null : read(raw), source, receipt };
}

function readNumber(value: YamlNode): number | null {
  return typeof value === "number" ? value : null;
}

function readBoolean(value: YamlNode): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readText(value: YamlNode): string | null {
  return typeof value === "string" ? value : null;
}

function readZoneTable(value: YamlNode): Record<number, number> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const table: Record<number, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    const zones = Number(key);
    if (!Number.isFinite(zones) || typeof entry !== "number") return null;
    table[zones] = entry;
  }
  return table;
}

function readStringList(value: YamlNode | undefined, where: string): string[] {
  if (!Array.isArray(value)) throw new Error(`profile: ${where} must be a list`);
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") throw new Error(`profile: ${where} entries must be text`);
    out.push(entry);
  }
  return out;
}

function buildProfile(doc: { [key: string]: YamlNode }, file: string): DeviceProfile {
  const text = (key: string, where: string): string => {
    const value = doc[key];
    if (typeof value !== "string" || value.length === 0) throw new Error(`profile: ${where} must be text`);
    return value;
  };
  const schema = text("schema", "schema");
  const sku = text("sku", "sku");
  const name = text("name", "name");
  const family = text("family", "family");
  if (doc["qualification_required"] !== true) {
    throw new Error("profile: qualification_required must be true: a profile is a default, every unit is qualified (spec 45)");
  }
  const capabilities = asMap(doc["capabilities"], "capabilities");
  const measurements = asMap(doc["measurements"], "measurements");
  const profile: DeviceProfile = {
    schema,
    sku,
    name,
    family,
    qualificationRequired: true,
    modes: readStringList(doc["modes"], "modes"),
    productMaterialSegments: measured(doc["product_material_segments"], "product_material_segments", readNumber),
    lengthMeters: measured(doc["length_m"], "length_m", readNumber),
    capabilities: {
      segmented: measured(capabilities["segmented"], "capabilities.segmented", readBoolean),
      lanRazer: measured(capabilities["lan_razer"], "capabilities.lan_razer", readBoolean),
      lanJsonControl: measured(capabilities["lan_json_control"], "capabilities.lan_json_control", readBoolean),
      ble: measured(capabilities["ble"], "capabilities.ble", readBoolean),
      matter: measured(capabilities["matter"], "capabilities.matter", readBoolean),
    },
    segmentChain: measured(doc["segment_chain"], "segment_chain", readText),
    nativePixelsPerMeter: measured(doc["native_pixels_per_meter"], "native_pixels_per_meter", readNumber),
    measurements: {
      armSettleMs: measured(measurements["arm_settle_ms"], "measurements.arm_settle_ms", readNumber),
      fallbackHz: measured(measurements["fallback_hz"], "measurements.fallback_hz", readNumber),
      maxHzByZones: measured(measurements["max_hz_by_zones"], "measurements.max_hz_by_zones", readZoneTable),
      turnEndsChannel: measured(measurements["turn_ends_channel"], "measurements.turn_ends_channel", readBoolean),
      whiteEndsChannel: measured(measurements["white_ends_channel"], "measurements.white_ends_channel", readBoolean),
      answersStatusWhileArmed: measured(
        measurements["answers_status_while_armed"],
        "measurements.answers_status_while_armed",
        readBoolean,
      ),
    },
    file,
  };
  return profile;
}

/** P-45 profile lint: a profile is only acceptable as a default when it says
 *  what is unmeasured and insists on qualification. Returns the problems; an
 *  empty list is clean. */
export function lintDeviceProfile(profile: DeviceProfile): string[] {
  const problems: string[] = [];
  if (!profile.qualificationRequired) problems.push("qualification_required must be true");
  if (profile.modes.length === 0) problems.push("modes must list at least one mode");
  if (!profile.sku.startsWith("H")) problems.push(`sku ${profile.sku} does not look like a Govee SKU`);
  if (basename(profile.file, ".yaml") !== profile.sku) {
    problems.push(`file ${profile.file} does not match sku ${profile.sku}`);
  }
  if (profile.capabilities.segmented.value === true && profile.capabilities.segmented.source !== "hardware-measured") {
    problems.push("capabilities.segmented may only be true from a hardware measurement: the T-GOV-10 probe decides per unit");
  }
  return problems;
}

export const DEFAULT_DEVICES_DIR = new URL("../../../devices/", import.meta.url);

/** Loads `devices/*.yaml` the way the fork's toolkit catalog does: every file
 *  is a profile, every profile must lint clean. */
export function loadDeviceCatalog(dir: string | URL = DEFAULT_DEVICES_DIR): DeviceCatalog {
  const base = typeof dir === "string" ? pathToFileURL(join(dir, "/")) : dir;
  const entries = readdirSync(dir).filter((entry) => entry.endsWith(".yaml")).sort();
  if (entries.length === 0) throw new Error(`profile catalog: no .yaml profiles under ${String(dir)}`);
  const profiles = new Map<string, DeviceProfile>();
  let schema = "";
  for (const entry of entries) {
    const doc = parseProfileYaml(readFileSync(new URL(entry, base), "utf8"));
    const profile = buildProfile(doc, entry);
    const problems = lintDeviceProfile(profile);
    if (problems.length > 0) throw new Error(`profile ${entry}: ${problems.join("; ")}`);
    if (profiles.has(profile.sku)) throw new Error(`profile catalog: ${profile.sku} is defined twice`);
    profiles.set(profile.sku, profile);
    schema = profile.schema;
  }
  return { schema, profiles };
}

/** The profile a new unit of this SKU starts from. */
export function profileDefaultsFor(catalog: DeviceCatalog, sku: string): DeviceProfile {
  const profile = catalog.profiles.get(sku);
  if (profile === undefined) {
    throw new Error(`profile catalog: no profile for ${sku}; the toolkit fork owns the profile table (spec 45)`);
  }
  return profile;
}

/**
 * Rate for a qualified zone count: the profile's measured ceiling for the
 * nearest table key at or below the count, else the fallback, never above the
 * target (spec 53, F-GOV-22). The wizard's rate sweep replaces this default
 * with the unit's own ceiling.
 */
export function defaultRateHz(profile: DeviceProfile, zones: number, targetHz: number): number {
  const table = profile.measurements.maxHzByZones.value;
  let ceiling = profile.measurements.fallbackHz.value ?? 10;
  if (table !== null) {
    const keys = Object.keys(table).map(Number).filter((key) => Number.isFinite(key)).sort((a, b) => a - b);
    for (const key of keys) {
      if (zones >= key) ceiling = table[key] ?? ceiling;
    }
  }
  return Math.max(1, Math.min(Math.max(1, Math.floor(targetHz)), ceiling));
}

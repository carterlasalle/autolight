import { KEYS, defaultFor } from "./registry.js";
import { isSecretId } from "./secrets.js";

// Layered resolution (T-CFG-02): built-in default < app < venue < device <
// style < session. Each layer is a partial map; get() walks highest first.
export type Scope = "app" | "venue" | "device" | "style" | "session";

const ORDER: Scope[] = ["app", "venue", "device", "style", "session"];

const rangeRe = /^\s*(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)\s*$/;

// Registry-effective JSON defaults arrive as parsed objects (see defaultFor),
// but an export/import round trip serializes them through JSON text, so a
// default that is stored as a raw string still parses back to the same value.
function jsonValueEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// Import validation for this store (T-CFG-02). Mirrors `validateImportValues`
// in store.ts without importing it (store.ts already imports this module, so
// an import would be a cycle): rejects secrets, unknown keys, NaN and
// out-of-range numbers, mistyped scalars, and non-JSON `json`-typed values.
function importValueErrors(values: Record<string, unknown>): string[] {
  const bad: string[] = [];

  for (const [k, v] of Object.entries(values)) {
    if (isSecretId(k)) {
      bad.push(`${k}: is a secret id, use the secrets-service (fix: remove it from the import)`);
      continue;
    }

    const def = KEYS.find((d) => d.key === k);

    if (!def) {
      bad.push(`${k}: unknown key (fix: remove it)`);
      continue;
    }

    if (def.type === "number") {
      if (typeof v !== "number" || Number.isNaN(v)) {
        bad.push(`${k}: got ${JSON.stringify(v)}, expected number in ${def.unit}, allowed ${def.range || "the allowed range"} (fix: use a number within ${def.range || "the allowed range"})`);
        continue;
      }

      const m = rangeRe.exec(def.range);

      if (m) {
        const lo = Number(m[1]!);
        const hi = Number(m[2]!);

        if (v < lo || v > hi) {
          bad.push(`${k}: got ${v}, allowed range ${def.range} ${def.unit} (fix: use a value within ${def.range})`);
        }
      }

      continue;
    }

    if (def.type === "boolean" && typeof v !== "boolean") {
      bad.push(`${k}: expected boolean, got ${typeof v} (fix: use true or false)`);
      continue;
    }

    if (def.type === "string" && typeof v !== "string") {
      bad.push(`${k}: expected string, got ${typeof v}`);
      continue;
    }

    if (def.type === "json") {
      let roundTrips = typeof v === "object" && v !== null;

      if (roundTrips) {
        try {
          JSON.parse(JSON.stringify(v));
        } catch {
          roundTrips = false;
        }
      }

      if (!roundTrips) bad.push(`${k}: expected a JSON object or array in ${def.unit}, got ${Array.isArray(v) ? "array" : typeof v} (fix: use a JSON-serializable object or array)`);
    }
  }

  return bad;
}

export class ConfigStore {
  private layers: Record<Scope, Map<string, unknown>> = {
    app: new Map(), venue: new Map(), device: new Map(), style: new Map(), session: new Map(),
  };

  set(scope: Scope, key: string, value: unknown): void {
    // Secrets never enter the config layer (T-SEC-01): they live in the
    // SecretVault behind Electron safeStorage, never in the JSON file.
    if (isSecretId(key)) throw new Error(`${key}: is a secret id, use the secrets-service (refusing plain-text write)`);
    // `get()`/`layerOf()` both key off Map presence; an explicit `undefined`
    // value would make them disagree, so it is not storable at all.
    if (value === undefined) throw new Error(`${key}: undefined is not a storable value (fix: reset() the key instead)`);
    this.layers[scope].set(key, value);
  }

  reset(scope: Scope, key: string): void {
    this.layers[scope].delete(key);
  }

  layerOf(key: string): Scope | "default" {
    for (let i = ORDER.length - 1; i >= 0; i--) {
      if (this.layers[ORDER[i]!]?.has(key)) return ORDER[i]!;
    }

    return "default";
  }

  get(key: string): unknown {
    for (let i = ORDER.length - 1; i >= 0; i--) {
      const layer = this.layers[ORDER[i]!];

      if (layer?.has(key)) return layer.get(key);
    }

    return defaultFor(key);
  }

  changedOnly(): Record<string, { value: unknown; layer: Scope }> {
    const out: Record<string, { value: unknown; layer: Scope }> = {};

    for (const k of KEYS) {
      const layer = this.layerOf(k.key);

      if (layer !== "default") out[k.key] = { value: this.get(k.key), layer };
    }

    return out;
  }

  exportJson(): string {
    const effective: Record<string, unknown> = {};
    const layers: Record<Scope, Record<string, unknown>> = {
      app: {}, venue: {}, device: {}, style: {}, session: {},
    };

    for (const k of KEYS) {
      const value = this.get(k.key);
      effective[k.key] = value;
      const layer = this.layerOf(k.key);

      if (layer !== "default") layers[layer][k.key] = value;
    }

    // `values` keeps the flattened effective view for older importers;
    // `layers` preserves origin so a round trip reproduces the live state.
    return JSON.stringify({ version: 1, values: effective, layers }, null, 2);
  }

  importJson(raw: string): { ok: true } | { ok: false; badKeys: string[] } {
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, badKeys: ["<unparseable JSON>"] };
    }

    const doc = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;

    if (doc === null || doc["version"] !== 1 || (doc["values"] !== undefined && (doc["values"] === null || typeof doc["values"] !== "object"))) {
      return { ok: false, badKeys: ["<unsupported config document>"] };
    }

    const values = (doc["values"] ?? {}) as Record<string, unknown>;
    const layers = doc["layers"] as Partial<Record<Scope, Record<string, unknown>>> | undefined;
    const bad = importValueErrors(values);

    if (bad.length > 0) return { ok: false, badKeys: bad };

    if (layers !== null && typeof layers === "object") {
      for (const scope of ORDER) {
        const scoped = layers[scope];

        if (scoped === undefined) continue;

        if (scoped === null || typeof scoped !== "object") return { ok: false, badKeys: [`<layers.${scope} is not an object>`] };
        const scopedBad = importValueErrors(scoped as Record<string, unknown>);

        if (scopedBad.length > 0) return { ok: false, badKeys: scopedBad };
      }

      for (const scope of ORDER) this.layers[scope].clear();

      let restored = false;

      for (const scope of ORDER) {
        const scoped = layers[scope];

        if (scoped === undefined) continue;
        restored = true;

        for (const [k, v] of Object.entries(scoped as Record<string, unknown>)) this.layers[scope].set(k, v);
      }

      if (!restored) for (const [k, v] of Object.entries(values)) this.layers["app"].set(k, v);
    } else {
      for (const [k, v] of Object.entries(values)) this.layers["app"].set(k, v);
    }

    return { ok: true };
  }
}

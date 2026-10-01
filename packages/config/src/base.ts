import { KEYS, defaultFor } from "./registry.js";
import { isSecretId } from "./secrets.js";
// Layered resolution (T-CFG-02): built-in default < app < venue < device <
// style < session. Each layer is a partial map; get() walks highest first.
export type Scope = "app" | "venue" | "device" | "style" | "session";
const ORDER: Scope[] = ["app", "venue", "device", "style", "session"];

export class ConfigStore {
  private layers: Record<Scope, Map<string, unknown>> = {
    app: new Map(), venue: new Map(), device: new Map(), style: new Map(), session: new Map(),
  };

  set(scope: Scope, key: string, value: unknown): void {
    // Secrets never enter the config layer (T-SEC-01): they live in the
    // SecretVault behind Electron safeStorage, never in the JSON file.
    if (isSecretId(key)) throw new Error(`${key}: is a secret id, use the secrets-service (refusing plain-text write)`);
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
      const v = this.layers[ORDER[i]!]?.get(key);
      if (v !== undefined) return v;
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
    for (const k of KEYS) effective[k.key] = this.get(k.key);
    return JSON.stringify({ version: 1, values: effective }, null, 2);
  }

  importJson(raw: string): { ok: true } | { ok: false; badKeys: string[] } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, badKeys: ["<unparseable JSON>"] };
    }
    const values = (parsed as { values?: Record<string, unknown> }).values ?? {};
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
      if (def.type === "number" && typeof v !== "number") {
        bad.push(`${k}: expected number in ${def.unit}, got ${typeof v} (fix: use a number within ${def.range || "the allowed range"})`);
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
    }
    if (bad.length > 0) return { ok: false, badKeys: bad };
    for (const [k, v] of Object.entries(values)) this.layers["app"].set(k, v);
    return { ok: true };
  }
}

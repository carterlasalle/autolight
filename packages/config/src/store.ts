import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { KEYS, defineKey } from "./registry.js";
import { ConfigStore, type Scope } from "./base.js";

// T-CFG-02 persistence and change events. The JSON file path is injected by
// the caller (production passes the userData path); nothing here hardcodes a
// path. Session overrides are temporary Live state and stay in memory only.

export const CONFIG_CHANGED = "config:changed";

export interface StoredLayers {
  version: 1;
  layers: Record<Scope, Record<string, unknown>>;
}

export interface ConfigChange {
  key: string;
  scope: Scope;
  layer: Scope | "default";
  before: unknown;
  after: unknown;
  liveSafe: boolean;
}

export type ConfigChangeListener = (change: ConfigChange) => void;

const PERSISTED: Scope[] = ["app", "venue", "device", "style"];

const layerMapSchema = z.record(z.string(), z.unknown());

const storedFileSchema = z.object({
  version: z.number(),
  layers: z.record(z.string(), layerMapSchema),
}).passthrough();

const importPayloadSchema = z.object({
  values: layerMapSchema.optional(),
}).passthrough();

function safeGet(store: ConfigStore, key: string): unknown {
  try {
    return store.get(key);
  } catch {
    return undefined;
  }
}

function safeLiveSafe(key: string): boolean {
  try {
    return defineKey(key).liveSafe;
  } catch {
    return false;
  }
}

// Validation for import payloads. Every rejection names the key, the value
// received, the allowed range or type, and the fix to apply.
export function validateImportValues(values: Record<string, unknown>): string[] {
  const bad: string[] = [];
  const rangeRe = /^\s*(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)\s*$/;
  for (const [k, v] of Object.entries(values)) {
    const def = KEYS.find((d) => d.key === k);
    if (!def) {
      bad.push(`${k}: unknown key, got ${JSON.stringify(v)} (fix: remove it)`);
      continue;
    }
    if (def.type === "number") {
      if (typeof v !== "number" || Number.isNaN(v)) {
        bad.push(
          `${k}: got ${JSON.stringify(v)}, expected number in ${def.unit}, allowed ${def.range || "the allowed range"} (fix: use a number within ${def.range || "the allowed range"})`,
        );
        continue;
      }
      const m = rangeRe.exec(def.range);
      if (m) {
        const lo = Number(m[1]!);
        const hi = Number(m[2]!);
        if (v < lo || v > hi) {
          bad.push(
            `${k}: got ${v}, allowed range ${def.range} ${def.unit} (fix: use a value within ${def.range})`,
          );
        }
      }
      continue;
    }
    if (def.type === "boolean" && typeof v !== "boolean") {
      bad.push(`${k}: got ${JSON.stringify(v)}, expected boolean (fix: use true or false)`);
      continue;
    }
    if (def.type === "string" && typeof v !== "string") {
      bad.push(`${k}: got ${JSON.stringify(v)}, expected string (fix: use a string value)`);
    }
  }
  return bad;
}

function readLayersFile(filePath: string): Record<Scope, Record<string, unknown>> | null {
  if (!existsSync(filePath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
  const check = storedFileSchema.safeParse(parsed);
  if (!check.success || check.data.version !== 1) return null;
  const layers = check.data.layers;
  const out: Record<Scope, Record<string, unknown>> = {
    app: {},
    venue: {},
    device: {},
    style: {},
    session: {},
  };
  for (const scope of PERSISTED) {
    const found = layers[scope];
    if (found) out[scope] = { ...found };
  }
  return out;
}

export class PersistentConfigStore extends ConfigStore {
  private filePath?: string;
  private mirror: Record<Scope, Map<string, unknown>> = {
    app: new Map(),
    venue: new Map(),
    device: new Map(),
    style: new Map(),
    session: new Map(),
  };
  private listeners = new Set<ConfigChangeListener>();

  constructor(filePath?: string) {
    super();
    if (filePath) {
      this.filePath = filePath;
      this.load();
    }
  }

  subscribe(fn: ConfigChangeListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(change: ConfigChange): void {
    for (const fn of Array.from(this.listeners)) fn(change);
  }

  override set(scope: Scope, key: string, value: unknown): void {
    const before = safeGet(this, key);
    super.set(scope, key, value);
    this.mirror[scope].set(key, value);
    this.emit({ key, scope, layer: this.layerOf(key), before, after: safeGet(this, key), liveSafe: safeLiveSafe(key) });
    this.save();
  }

  override reset(scope: Scope, key: string): void {
    const before = safeGet(this, key);
    super.reset(scope, key);
    this.mirror[scope].delete(key);
    this.emit({ key, scope, layer: this.layerOf(key), before, after: safeGet(this, key), liveSafe: safeLiveSafe(key) });
    this.save();
  }

  override importJson(raw: string): { ok: true } | { ok: false; badKeys: string[] } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, badKeys: ["<unparseable JSON>"] };
    }
    const check = importPayloadSchema.safeParse(parsed);
    const values = check.success ? (check.data.values ?? {}) : {};
    const bad = validateImportValues(values);
    if (bad.length > 0) return { ok: false, badKeys: bad };
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(values)) before[k] = safeGet(this, k);
    for (const [k, v] of Object.entries(values)) {
      super.set("app", k, v);
      this.mirror.app.set(k, v);
    }
    for (const k of Object.keys(values)) {
      this.emit({ key: k, scope: "app", layer: this.layerOf(k), before: before[k], after: safeGet(this, k), liveSafe: safeLiveSafe(k) });
    }
    this.save();
    return { ok: true };
  }

  load(): void {
    if (!this.filePath) return;
    const found = readLayersFile(this.filePath);
    if (!found) return;
    for (const scope of PERSISTED) {
      for (const k of Array.from(this.mirror[scope].keys())) {
        super.reset(scope, k);
        this.mirror[scope].delete(k);
      }
    }
    for (const scope of PERSISTED) {
      for (const [k, v] of Object.entries(found[scope])) {
        try {
          defineKey(k);
        } catch {
          continue;
        }
        super.set(scope, k, v);
        this.mirror[scope].set(k, v);
      }
    }
  }

  save(): void {
    if (!this.filePath) return;
    const payload: StoredLayers = {
      version: 1,
      layers: {
        app: Object.fromEntries(this.mirror.app),
        venue: Object.fromEntries(this.mirror.venue),
        device: Object.fromEntries(this.mirror.device),
        style: Object.fromEntries(this.mirror.style),
        session: {},
      },
    };
    writeFileSync(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }
}

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { KEYS, defineKey } from "./registry.js";
import { isSecretId } from "./secrets.js";
import { ConfigStore, type Scope } from "./base.js";

// T-CFG-02 persistence and change events. The JSON file path is injected by
// the caller (production passes the userData path); nothing here hardcodes a
// path. Session overrides are temporary Live state and stay in memory only.

export const CONFIG_CHANGED = "config:changed";

interface StoredLayers {
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

const ALL_SCOPES: Scope[] = ["app", "venue", "device", "style", "session"];

const layerMapSchema = z.record(z.string(), z.unknown());

const storedFileSchema = z.object({
  version: z.number(),
  layers: z.record(z.string(), layerMapSchema),
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
    if (isSecretId(k)) {
      bad.push(`${k}: is a secret id, use the secrets-service (fix: remove it from the import)`);
      continue;
    }

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
  // Keys this instance explicitly removed from a layer (reset, or dropped by
  // an import): the save() sibling merge must not re-adopt them from disk, or
  // a reset would resurrect the value it just removed.
  private readonly removed: Record<Scope, Set<string>> = {
    app: new Set(), venue: new Set(), device: new Set(), style: new Set(), session: new Set(),
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

  // A listener must never drop the save or starve later listeners: one bad
  // subscriber cannot take the store down with it.
  private emit(change: ConfigChange): void {
    for (const fn of Array.from(this.listeners)) {
      try {
        fn(change);
      } catch {
        // Listener errors are deliberately swallowed here; persistence already
        // happened above, and the remaining listeners still get the change.
      }
    }
  }

  override set(scope: Scope, key: string, value: unknown): void {
    const before = safeGet(this, key);
    super.set(scope, key, value);
    this.mirror[scope].set(key, value);
    this.removed[scope].delete(key);
    // Persist before emitting: a listener that throws used to skip the save
    // entirely, leaving memory changed and the file stale.
    this.save();
    this.emit({ key, scope, layer: this.layerOf(key), before, after: safeGet(this, key), liveSafe: safeLiveSafe(key) });
  }

  override reset(scope: Scope, key: string): void {
    const before = safeGet(this, key);
    super.reset(scope, key);
    this.mirror[scope].delete(key);
    this.removed[scope].add(key);
    this.save();
    this.emit({ key, scope, layer: this.layerOf(key), before, after: safeGet(this, key), liveSafe: safeLiveSafe(key) });
  }

  override importJson(raw: string): { ok: true } | { ok: false; badKeys: string[] } {
    const before = new Map<string, { value: unknown; scope: Scope }>();

    for (const scope of ALL_SCOPES) {
      for (const k of this.mirror[scope].keys()) {
        if (!before.has(k)) before.set(k, { value: safeGet(this, k), scope });
      }
    }

    // The base owns document validation and layer application (flattened
    // values plus optional per-layer origins); the store mirrors the result,
    // tombstones what the document dropped, persists once and emits diffs.
    const res = super.importJson(raw);

    if (!res.ok) return res;

    for (const scope of ALL_SCOPES) {
      const next = new Map<string, unknown>();

      for (const k of KEYS) {
        if (this.layerOf(k.key) === scope) next.set(k.key, this.get(k.key));
      }

      for (const k of this.mirror[scope].keys()) {
        if (!next.has(k)) this.removed[scope].add(k);
      }

      for (const k of next.keys()) this.removed[scope].delete(k);
      this.mirror[scope] = next;
    }

    this.save();

    for (const k of KEYS) {
      const old = before.get(k.key);
      const after = safeGet(this, k.key);

      if (!Object.is(old?.value, after)) {
        const layer = this.layerOf(k.key);

        this.emit({
          key: k.key,
          scope: layer === "default" ? (old?.scope ?? "app") : layer,
          layer,
          before: old?.value,
          after,
          liveSafe: safeLiveSafe(k.key),
        });
      }
    }

    return res;
  }

  load(): void {
    if (!this.filePath) return;
    const found = readLayersFile(this.filePath);

    if (!found) return;

    // The file is authoritative after a load: removal intents from before it
    // must not suppress its merge.
    for (const scope of ALL_SCOPES) this.removed[scope].clear();

    for (const scope of PERSISTED) {
      for (const k of Array.from(this.mirror[scope].keys())) {
        const before = safeGet(this, k);
        super.reset(scope, k);
        this.mirror[scope].delete(k);
        this.emit({ key: k, scope, layer: this.layerOf(k), before, after: safeGet(this, k), liveSafe: safeLiveSafe(k) });
      }
    }

    for (const scope of PERSISTED) {
      for (const [k, v] of Object.entries(found[scope])) {
        let liveSafe = false;

        try {
          liveSafe = defineKey(k).liveSafe;
        } catch {
          throw new Error(`unknown-config-key in ${this.filePath}: ${k}`);
        }

        const before = safeGet(this, k);
        super.set(scope, k, v);
        this.mirror[scope].set(k, v);
        this.emit({ key: k, scope, layer: this.layerOf(k), before, after: safeGet(this, k), liveSafe });
      }
    }
  }

  save(): void {
    if (!this.filePath) return;

    // Re-read before writing so a sibling store that persisted since our last
    // load does not get clobbered by this instance's stale mirror: keys this
    // store never touched keep the other store's values (last writer still
    // wins per key it touched, but untouched keys survive).
    const onDisk = readLayersFile(this.filePath);

    if (onDisk !== null) {
      for (const scope of PERSISTED) {
        for (const [k, v] of Object.entries(onDisk[scope])) {
          if (!this.mirror[scope].has(k) && !this.removed[scope].has(k)) {
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
    }

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

    // Atomic write: a crash, ENOSPC or a second writer mid-write must never
    // leave a truncated config behind (rename is atomic on one filesystem).
    // On corruption the reader above returns null and the store keeps its
    // in-memory values instead of discarding everything silently.
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    renameSync(tmp, this.filePath);
  }
}

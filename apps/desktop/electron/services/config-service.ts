import { join } from "node:path";
import {
  KEYS as CONFIG_KEYS,
  PersistentConfigStore,
  defineKey,
  type ConfigChange,
  type Scope,
} from "@autolight/config";
import { ServiceTracker, messageOf, type Service, type ServiceStatus } from "./base.js";

// config-service (04-target-architecture section 1): the registry, the layer
// stack and their persistence, plus change events. Moved out of
// electron/show-service.ts (T-ARC-05). Only this service owns the config file.

export interface ConfigServiceOptions {
  // Explicit override, used by tests; production resolves userData.
  filePath?: string;
  userDataDir?: string;
}

export interface ConfigValueReply {
  ok: true;
  key: string;
  value: unknown;
  layer: string;
  liveSafe: boolean;
}

export interface ConfigSetReply {
  ok: true;
  key: string;
  scope: string;
  value: unknown;
  layer: string;
}

export interface ConfigImportReply {
  ok: true;
  applied: number;
}

export interface ConfigSchemaReply {
  ok: true;
  keys: { key: string; type: string; scope: string; unit: string; range: string; liveSafe: boolean }[];
}

export interface ConfigErrorReply {
  ok: false;
  error: { code: string; message: string };
}

export class ConfigService implements Service {
  readonly name = "config-service";
  private readonly tracker = new ServiceTracker("config-service");
  private store: PersistentConfigStore | null = null;
  private history: ConfigChange[] = [];
  private readonly listeners = new Set<(change: ConfigChange) => void>();
  private readonly opts: ConfigServiceOptions;

  constructor(opts: ConfigServiceOptions = {}) {
    this.opts = opts;
  }

  // Electron owns userData; the dynamic import keeps this service importable
  // in plain Node (tests) where `electron` has no app object.
  private async userDataDir(): Promise<string | undefined> {
    if (this.opts.userDataDir !== undefined) return this.opts.userDataDir;
    try {
      const { app } = await import("electron");
      return app.getPath("userData");
    } catch {
      return undefined;
    }
  }

  async start(): Promise<ServiceStatus> {
    if (this.store) return this.status();
    this.tracker.set("starting");
    let filePath = this.opts.filePath;
    if (filePath === undefined) {
      const dir = await this.userDataDir();
      filePath = dir === undefined ? undefined : join(dir, "config.json");
    }
    try {
      this.store = new PersistentConfigStore(filePath);
      this.store.subscribe((change) => {
        this.history.push(change);
        this.tracker.count("changes");
        for (const listener of this.listeners) listener(change);
      });
    } catch (err) {
      this.tracker.set("failed", `config store unavailable: ${messageOf(err)}`);
      return this.status();
    }
    this.tracker.setCounter("keys", CONFIG_KEYS.length);
    this.tracker.set("running", filePath === undefined ? "in-memory (no userData path)" : `layers persisted at ${filePath}`);
    this.tracker.setCounter("changes", this.history.length);
    return this.status();
  }

  stop(): ServiceStatus {
    // Flush before dropping the reference: the file is the durable layer.
    try {
      this.store?.save();
    } catch { /* teardown never throws */ }
    this.store = null;
    this.tracker.set("stopped");
    return this.status();
  }

  status(): ServiceStatus {
    this.tracker.setCounter("changes", this.history.length);
    if (this.store) {
      let changed = 0;
      try {
        changed = Object.keys(this.store.changedOnly()).length;
      } catch { /* store still usable; counter keeps its last value */ }
      this.tracker.setCounter("savedLayers", changed);
    }
    return this.tracker.status();
  }

  private requireStore(): PersistentConfigStore {
    if (!this.store) throw new Error("config-service not started");
    return this.store;
  }

  changedLayers(): Record<string, { value: unknown; layer: Scope }> {
    return this.requireStore().changedOnly();
  }

  onChanged(listener: (change: ConfigChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  changes(): ConfigChange[] {
    return this.history.map((c) => ({ ...c }));
  }

  flush(): void {
    this.requireStore().save();
  }

  get(key: string): ConfigValueReply | ConfigErrorReply {
    let def;
    try {
      def = defineKey(key);
    } catch {
      return { ok: false, error: { code: "E_UNKNOWN_KEY", message: `${key}: unknown key (fix: remove it or pick a registry key)` } };
    }
    let value: unknown;
    try {
      value = this.requireStore().get(key);
    } catch (err) {
      return { ok: false, error: { code: "E_CONFIG_GET", message: `${key}: ${messageOf(err)}` } };
    }
    return { ok: true, key, value, layer: this.requireStore().layerOf(key), liveSafe: def.liveSafe };
  }

  set(scope: Scope, key: string, value: unknown): ConfigSetReply | ConfigErrorReply {
    try {
      defineKey(key);
    } catch {
      return { ok: false, error: { code: "E_UNKNOWN_KEY", message: `${key}: unknown key (fix: remove it or pick a registry key)` } };
    }
    const store = this.requireStore();
    try {
      store.set(scope, key, value);
    } catch (err) {
      return { ok: false, error: { code: "E_CONFIG_SET", message: `${key}: ${messageOf(err)}` } };
    }
    this.tracker.count("sets");
    return { ok: true, key, scope, value, layer: store.layerOf(key) };
  }

  reset(scope: Scope, key: string): { ok: true; key: string; scope: string } {
    const store = this.requireStore();
    store.reset(scope, key);
    this.tracker.count("resets");
    return { ok: true, key, scope };
  }

  exportJson(): { ok: true; json: string } {
    return { ok: true, json: this.requireStore().exportJson() };
  }

  importJson(json: string): ConfigImportReply | ConfigErrorReply {
    const res = this.requireStore().importJson(json);
    if (!res.ok) {
      return { ok: false, error: { code: "E_CONFIG_IMPORT", message: res.badKeys.join("; ") } };
    }
    let applied = 0;
    try {
      const parsed: unknown = JSON.parse(json);
      if (parsed !== null && typeof parsed === "object" && "values" in parsed) {
        const values = parsed.values;
        if (values !== null && typeof values === "object") applied = Object.keys(values).length;
      }
    } catch {
      applied = 0;
    }
    this.tracker.count("imports");
    return { ok: true, applied };
  }

  schema(key?: string): ConfigSchemaReply {
    const rows = (key === undefined ? CONFIG_KEYS : CONFIG_KEYS.filter((k) => k.key === key)).map((k) => ({
      key: k.key,
      type: k.type,
      scope: k.scope,
      unit: k.unit,
      range: k.range,
      liveSafe: k.liveSafe,
    }));
    return { ok: true, keys: rows };
  }
}

export function createConfigService(opts: ConfigServiceOptions = {}): ConfigService {
  return new ConfigService(opts);
}

let instance: ConfigService | null = null;

// Singleton used by the IPC router; starting is idempotent so a handler can
// ask for the service on every call.
export async function getConfigService(opts: ConfigServiceOptions = {}): Promise<ConfigService> {
  instance ??= new ConfigService(opts);
  const state = instance.status().state;
  if (state === "idle" || state === "stopped" || state === "failed") await instance.start();
  return instance;
}

export function resetConfigServiceForTest(): void {
  instance = null;
}

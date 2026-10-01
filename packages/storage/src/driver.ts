import { createRequire } from "node:module";
import type { DatabaseSync as NodeSqliteDatabase } from "node:sqlite";

// Storage driver policy (DS-06). The application database is SQLite in WAL
// mode and is completely separate from Rekordbox and Serato data (spec 80).
// The preferred driver is better-sqlite3 (spec 80). node:sqlite, the built-in
// driver, is the fallback so a native module that cannot load for this
// runtime never bricks startup. The chosen driver, the fallback reason and
// every pragma read-back are reported as visible status (P-80 evidence)
// instead of being assumed.

// import.meta is a real object in ESM; the esbuild CommonJS build of the
// Electron main process leaves it empty, so read the field defensively.
export function esmModuleUrl(): string | null {
  const meta: unknown = import.meta;
  if (meta !== null && typeof meta === "object" && "url" in meta && typeof meta.url === "string" && meta.url.length > 0) {
    return meta.url;
  }
  return null;
}

// Module loading has to work in three places: plain ESM (package tests and
// dist), the esbuild CommonJS bundle of the Electron main process, and a
// worker thread. node: builtins go through process.getBuiltinModule, the
// bundle has a real require, and createRequire covers plain ESM.
function loadModule(id: string): unknown {
  if (id.startsWith("node:") && typeof process.getBuiltinModule === "function") {
    return process.getBuiltinModule(id);
  }
  if (typeof require === "function") return require(id);
  const metaUrl = esmModuleUrl();
  if (metaUrl !== null) return createRequire(metaUrl)(id);
  throw new Error(`storage cannot load ${id}: this runtime exposes no module loader`);
}

export type DriverName = "better-sqlite3" | "node-sqlite";
export type DriverPreference = "auto" | DriverName;
export type SqlParam = string | number | bigint | Uint8Array | null;

export interface SqlExec {
  exec(sql: string): void;
  get<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): T | undefined;
  all<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): T[];
  run(sql: string, params?: readonly SqlParam[]): void;
}

export interface DbDriver extends SqlExec {
  readonly name: DriverName;
  close(): void;
}

export interface ModuleStatus {
  module: string;
  available: boolean;
  detail: string;
}

export interface DriverStatus {
  requested: DriverPreference;
  chosen: DriverName;
  fellBack: boolean;
  fallbackReason: string | null;
  betterSqlite3: ModuleStatus;
  nodeSqlite: ModuleStatus;
  nodeVersion: string;
  electronVersion: string | null;
}

const probeCache = new Map<string, ModuleStatus>();

// Load probe: requiring the module is the test (a native ABI mismatch throws).
export function moduleStatus(module: string): ModuleStatus {
  const cached = probeCache.get(module);
  if (cached) return cached;
  let status: ModuleStatus;
  try {
    loadModule(module);
    status = { module, available: true, detail: "loads in this runtime" };
  } catch (error) {
    // Module load errors carry a multi-line require stack; a status line wants
    // the first line only.
    const detail = ((error as Error).message.split("\n")[0] ?? "").trim() || "module did not load";
    status = { module, available: false, detail };
  }
  probeCache.set(module, status);
  return status;
}

interface BetterStatement {
  get(...params: SqlParam[]): unknown;
  all(...params: SqlParam[]): unknown[];
  run(...params: SqlParam[]): unknown;
}

interface BetterDatabase {
  exec(sql: string): void;
  prepare(sql: string): BetterStatement;
  close(): void;
}

interface BetterCtor {
  new (path: string): BetterDatabase;
}

interface NodeSqliteModule {
  DatabaseSync: new (path: string) => NodeSqliteDatabase;
}

function openBetterSqlite3(path: string): DbDriver {
  // Shape of better-sqlite3's public constructor (spec 80 driver).
  const Ctor = loadModule("better-sqlite3") as BetterCtor;
  const db = new Ctor(path);
  return {
    name: "better-sqlite3",
    exec: (sql) => {
      db.exec(sql);
    },
    get: <T,>(sql: string, params: readonly SqlParam[] = []) => db.prepare(sql).get(...params) as T | undefined,
    all: <T,>(sql: string, params: readonly SqlParam[] = []) => db.prepare(sql).all(...params) as T[],
    run: (sql, params = []) => {
      db.prepare(sql).run(...params);
    },
    close: () => {
      db.close();
    },
  };
}

function openNodeSqlite(path: string): DbDriver {
  // Shape of node:sqlite's DatabaseSync (built-in fallback driver).
  const mod = loadModule("node:sqlite") as NodeSqliteModule;
  const db = new mod.DatabaseSync(path);
  return {
    name: "node-sqlite",
    exec: (sql) => {
      db.exec(sql);
    },
    get: <T,>(sql: string, params: readonly SqlParam[] = []) => db.prepare(sql).get(...params) as T | undefined,
    all: <T,>(sql: string, params: readonly SqlParam[] = []) => db.prepare(sql).all(...params) as T[],
    run: (sql, params = []) => {
      db.prepare(sql).run(...params);
    },
    close: () => {
      db.close();
    },
  };
}

export interface OpenOptions {
  path: string;
  driver?: DriverPreference;
  // storage.sqlite.synchronous from config; SQLite names OFF, NORMAL, FULL.
  synchronous?: string;
  // storage.sqlite.busyTimeoutMs from config.
  busyTimeoutMs?: number;
  // WAL is required for file databases and meaningless for :memory:.
  requireWal?: boolean;
  foreignKeys?: boolean;
}

export interface OpenResult {
  driver: DbDriver;
  status: DriverStatus;
  journalMode: string;
  synchronous: string;
  busyTimeoutMs: number;
  foreignKeys: boolean;
}

const SYNC_MODES: Record<string, true> = { OFF: true, NORMAL: true, FULL: true, EXTRA: true };
const SYNC_NAMES = ["OFF", "NORMAL", "FULL", "EXTRA"] as const;

function pragmaValue(driver: SqlExec, name: string): string {
  const row = driver.get<Record<string, unknown>>(`PRAGMA ${name}`);
  if (!row) return "";
  const first = Object.values(row)[0];
  return first === undefined || first === null ? "" : String(first);
}

// `PRAGMA synchronous` reads back the numeric level, not the name.
function syncName(readBack: string): string {
  const level = Number(readBack);
  if (!Number.isInteger(level)) return readBack.toUpperCase();
  return SYNC_NAMES[level] ?? readBack;
}

export function openDatabase(options: OpenOptions): OpenResult {
  const requested: DriverPreference = options.driver ?? "auto";
  const path = options.path;
  const memory = path === ":memory:" || path.startsWith("file::memory:");
  const requireWal = options.requireWal ?? !memory;
  const better = moduleStatus("better-sqlite3");
  let fallbackReason: string | null = null;
  let driver: DbDriver;
  if (requested === "better-sqlite3" || (requested === "auto" && better.available)) {
    try {
      driver = openBetterSqlite3(path);
    } catch (error) {
      if (requested === "better-sqlite3") {
        throw new Error(
          `storage driver better-sqlite3 was requested but failed to open "${path}": ${(error as Error).message}`,
        );
      }
      fallbackReason = `better-sqlite3 open failed: ${(error as Error).message}`;
      driver = openNodeSqlite(path);
    }
  } else {
    if (requested === "auto") fallbackReason = better.detail;
    driver = openNodeSqlite(path);
  }

  try {
    const syncRaw = String(options.synchronous ?? "NORMAL").toUpperCase();
    if (SYNC_MODES[syncRaw] !== true) {
      throw new Error(
        `invalid storage.sqlite.synchronous "${options.synchronous}": use one of ${Object.keys(SYNC_MODES).join(", ")}`,
      );
    }
    const busyRaw = options.busyTimeoutMs ?? 5000;
    if (!Number.isInteger(busyRaw) || busyRaw < 0) {
      throw new Error(`invalid storage.sqlite.busyTimeoutMs "${options.busyTimeoutMs}": use a whole number of milliseconds`);
    }
    const wantForeignKeys = options.foreignKeys ?? true;

    if (requireWal) driver.exec("PRAGMA journal_mode = WAL");
    const journalMode = pragmaValue(driver, "journal_mode") || "unknown";
    if (requireWal && journalMode.toLowerCase() !== "wal") {
      throw new Error(
        `WAL mode was not enabled for "${path}": PRAGMA journal_mode reads back "${journalMode}"`,
      );
    }
    driver.exec(`PRAGMA synchronous = ${syncRaw}`);
    const synchronous = syncName(pragmaValue(driver, "synchronous") || syncRaw);
    driver.exec(`PRAGMA busy_timeout = ${busyRaw}`);
    const busyTimeoutMs = Number(pragmaValue(driver, "busy_timeout") || busyRaw);
    if (wantForeignKeys) {
      driver.exec("PRAGMA foreign_keys = ON");
      const enabled = pragmaValue(driver, "foreign_keys");
      if (enabled !== "1") {
        throw new Error(`foreign keys were not enabled for "${path}": PRAGMA foreign_keys reads back "${enabled}"`);
      }
    }
    const foreignKeys = pragmaValue(driver, "foreign_keys") === "1";

    const status: DriverStatus = {
      requested,
      chosen: driver.name,
      fellBack: requested === "auto" && driver.name !== "better-sqlite3",
      fallbackReason,
      betterSqlite3: better,
      nodeSqlite: moduleStatus("node:sqlite"),
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron ?? null,
    };
    return { driver, status, journalMode, synchronous, busyTimeoutMs, foreignKeys };
  } catch (error) {
    driver.close();
    throw error;
  }
}

// One line a startup log or a Diagnostics panel can show verbatim, including
// the fallback reason when the native driver did not load.
export function describeDriver(status: DriverStatus): string {
  const fallback = status.fellBack
    ? `, fell back from better-sqlite3 (${status.fallbackReason ?? "unknown reason"})`
    : "";
  return `driver ${status.chosen}${fallback}, node ${status.nodeVersion}, electron ${status.electronVersion ?? "none"}`;
}

import { join } from "node:path";
import { app } from "electron";
import {
  describeDriver,
  moduleStatus,
  type DriverPreference,
  type DriverStatus,
  Store,
} from "@autolight/storage";

// Main-process storage service (T-DATA-01, spec 80, 132 stage 2). It opens
// the application database in userData/autolight.db with the DS-06 driver
// policy, applies the WAL, synchronous, busy-timeout and foreign-key pragmas
// from config, runs the migrations and reports what it actually got, so the
// app never assumes a mode it did not verify. The database is completely
// separate from Rekordbox and Serato data.

// The layered config store from T-CFG-02. Only reads happen here.
export interface StorageConfig {
  get(key: string): unknown;
}

export interface StorageServiceOptions {
  path?: string;
  driver?: DriverPreference;
  config?: StorageConfig;
}

export interface StorageServiceStatus {
  name: string;
  // Section 1 service vocabulary (T-ARC-05): the database is running once the
  // service exists, stopped after stop().
  state: "running" | "stopped";
  open: boolean;
  path: string;
  driver: DriverStatus["chosen"];
  driverLine: string;
  fellBack: boolean;
  fallbackReason: string | null;
  journalMode: string;
  synchronous: string;
  busyTimeoutMs: number;
  foreignKeys: boolean;
  schemaVersion: number;
  pendingMigrations: number[];
  tables: number;
  // Spec 80 self-test: node:sqlite must load inside the app's Electron, and
  // the runtime versions are recorded next to the result.
  nodeSqliteAvailable: boolean;
  nodeSqliteDetail: string;
  nodeVersion: string;
  electronVersion: string | null;
  userDataDir: string;
}

export interface StorageService {
  readonly name: string;
  readonly store: Store;
  // The database is open as soon as this object exists; start() reports that
  // state so lifecycle wiring can treat it like every other service.
  start(): StorageServiceStatus;
  stop(): StorageServiceStatus;
  close(): StorageServiceStatus;
  status(): StorageServiceStatus;
  statusLine(): string;
}

const SERVICE_NAME = "storage";
const SYNCHRONOUS_DEFAULT = "NORMAL";
const BUSY_TIMEOUT_DEFAULT = 5000;

function configString(config: StorageConfig | undefined, key: string, fallback: string): string {
  const value = config?.get(key);
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function configNumber(config: StorageConfig | undefined, key: string, fallback: number): number {
  const value = config?.get(key);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// DS-06 accepts auto, better-sqlite3 or node-sqlite; anything else is auto.
function configDriver(config: StorageConfig | undefined): DriverPreference {
  const value = configString(config, "storage.driver", "auto");
  return value === "better-sqlite3" || value === "node-sqlite" ? value : "auto";
}

// userData comes from Electron; the E2E harness passes the same directory as
// AUTOLIGHT_USER_DATA_DIR, which wins so tests can pin a temp profile.
export function resolveUserDataDir(): string {
  const override = process.env["AUTOLIGHT_USER_DATA_DIR"];
  if (override !== undefined && override.length > 0) return override;
  try {
    return app.getPath("userData");
  } catch {
    return process.cwd();
  }
}

let service: StorageService | null = null;

export function openStorageService(options: StorageServiceOptions = {}): StorageService {
  if (service) return service;
  const userDataDir = resolveUserDataDir();
  const path = options.path ?? join(userDataDir, "autolight.db");
  const store = new Store({
    path,
    driver: options.driver ?? configDriver(options.config),
    synchronous: configString(options.config, "storage.sqlite.synchronous", SYNCHRONOUS_DEFAULT),
    busyTimeoutMs: configNumber(options.config, "storage.sqlite.busyTimeoutMs", BUSY_TIMEOUT_DEFAULT),
  });
  const nodeSqlite = moduleStatus("node:sqlite");
  let open = true;
  // Everything the database reported at open time is recorded once, so a
  // status read after stop() still tells the truth instead of querying a
  // closed handle.
  const opened = {
    driverStatus: store.status,
    journalMode: store.journalMode,
    synchronous: store.synchronous,
    busyTimeoutMs: store.busyTimeoutMs,
    foreignKeys: store.foreignKeys,
    schemaVersion: store.version,
    pendingMigrations: store.pendingMigrations,
    tables: store.tables.length,
  };
  const statusLine = (): string =>
    `db ${path}, ${describeDriver(opened.driverStatus)}, journal ${opened.journalMode}, ` +
    `synchronous ${opened.synchronous}, busyTimeout ${opened.busyTimeoutMs} ms, ` +
    `foreignKeys ${opened.foreignKeys ? "on" : "off"}, schema v${opened.schemaVersion}, ` +
    `${opened.tables} tables`;
  const snapshot = (): StorageServiceStatus => ({
    name: SERVICE_NAME,
    state: open ? "running" : "stopped",
    open,
    path,
    driver: opened.driverStatus.chosen,
    driverLine: statusLine(),
    fellBack: opened.driverStatus.fellBack,
    fallbackReason: opened.driverStatus.fallbackReason,
    journalMode: opened.journalMode,
    synchronous: opened.synchronous,
    busyTimeoutMs: opened.busyTimeoutMs,
    foreignKeys: opened.foreignKeys,
    schemaVersion: opened.schemaVersion,
    pendingMigrations: opened.pendingMigrations,
    tables: opened.tables,
    nodeSqliteAvailable: nodeSqlite.available,
    nodeSqliteDetail: nodeSqlite.detail,
    nodeVersion: opened.driverStatus.nodeVersion,
    electronVersion: opened.driverStatus.electronVersion,
    userDataDir,
  });
  const instance: StorageService = {
    name: SERVICE_NAME,
    store,
    start: snapshot,
    stop: () => {
      if (open) {
        store.close();
        open = false;
        if (service === instance) service = null;
      }
      return snapshot();
    },
    close: () => instance.stop(),
    status: snapshot,
    statusLine,
  };
  service = instance;
  return instance;
}

export function getStorageService(): StorageService | null {
  return service;
}

export function closeStorageService(): StorageServiceStatus | null {
  return service?.stop() ?? null;
}

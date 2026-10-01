// Read-only database handles for the Rekordbox library (T-RBL-01, spec 4.1).
//
// Two drivers behind one interface:
//   node:sqlite                      plain SQLite, `readOnly: true`, no native
//                                    module needed (fixture databases, tests)
//   better-sqlite3-multiple-ciphers  SQLCipher master.db, opened readonly with
//                                    read_uncommitted so reads see committed
//                                    WAL content without ever checkpointing
//
// No handle exposes a write method; the raw handle is kept only for the
// read-only self check (an attempted write must throw) and is never handed to
// services or the UI. A checkpoint is a write, so nothing here runs one.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export type SqlParam = string | number | bigint | null | Uint8Array;
export type SqlParams = Record<string, SqlParam>;
export type SqlRow = Record<string, unknown>;

export type LibraryDbErrorCode = "not-found" | "not-a-database" | "cipher-module-missing" | "driver-failed";

export class LibraryDbError extends Error {
  readonly code: LibraryDbErrorCode;

  constructor(message: string, code: LibraryDbErrorCode) {
    super(message);
    this.name = "LibraryDbError";
    this.code = code;
  }
}

export type DbDriverName = "node:sqlite" | "better-sqlite3-multiple-ciphers";

export interface ReadOnlyDb {
  /** Which driver opened the file, for diagnostics. */
  readonly driver: DbDriverName;
  all(sql: string, params?: SqlParams): SqlRow[];
  get(sql: string, params?: SqlParams): SqlRow | undefined;
  close(): void;
  /** Underlying driver handle; the read-only self check uses it, nothing else. */
  readonly raw: unknown;
}

export const CIPHER_MODULE = "better-sqlite3-multiple-ciphers";

interface StatementLike {
  all(params: SqlParams): SqlRow[];
  get(params: SqlParams): SqlRow | undefined;
}

function adapter(
  driver: DbDriverName,
  prepare: (sql: string) => StatementLike,
  close: () => void,
  raw: unknown,
): ReadOnlyDb {
  return {
    driver,
    all: (sql, params) => prepare(sql).all(params ?? {}),
    get: (sql, params) => prepare(sql).get(params ?? {}),
    close,
    raw,
  };
}

interface CipherHandle {
  prepare(sql: string): {
    all(params: SqlParams): Record<string, SqlParam>[];
    get(params: SqlParams): Record<string, SqlParam> | undefined;
  };
  pragma(stmt: string): unknown;
  close(): void;
}

// Optional native module: pick its callable constructor without fabricating a
// shape for the whole namespace object.
function ctorOf(mod: unknown): unknown {
  if (typeof mod === "object" && mod !== null && "default" in mod) return mod.default;
  return mod;
}

// SQLCipher driver. The module is an optional native dependency (Electron
// rebuild list, T-OPS-05) and is absent on machines that never install it; a
// static import would fail type-check and load without it, so the specifier is
// a runtime variable.
async function openWithCipher(dbPath: string, key: string): Promise<ReadOnlyDb | undefined> {
  const specifier = CIPHER_MODULE;
  let mod: unknown;
  try {
    mod = await import(/* @vite-ignore */ specifier);
  } catch {
    return undefined;
  }
  const ctor = ctorOf(mod);
  if (typeof ctor !== "function") return undefined;
  // Reason for the cast: the module ships no typings this package can import
  // statically while the dependency stays optional.
  const CipherCtor = ctor as new (
    path: string,
    options: { readonly: boolean; fileMustExist: boolean },
  ) => CipherHandle;
  const handle = new CipherCtor(dbPath, { readonly: true, fileMustExist: true });
  try {
    handle.pragma("cipher='sqlcipher'");
    handle.pragma("legacy=4");
    handle.pragma(`key='${key}'`);
    // Read committed-but-uncheckpointed rows written by Rekordbox's own handle.
    handle.pragma("read_uncommitted=true");
    handle.pragma("query_only=ON");
    handle.prepare("SELECT count(*) AS n FROM sqlite_master").get({});
  } catch {
    handle.close();
    return undefined;
  }
  return adapter(
    "better-sqlite3-multiple-ciphers",
    (sql) => handle.prepare(sql),
    () => {
      handle.close();
    },
    handle,
  );
}

function openWithNodeSqlite(dbPath: string): ReadOnlyDb {
  let handle: DatabaseSync;
  try {
    handle = new DatabaseSync(dbPath, { readOnly: true });
  } catch (error) {
    throw new LibraryDbError(`could not open ${dbPath} read-only: ${describe(error)}`, "driver-failed");
  }
  const prepare = (sql: string): StatementLike => {
    const stmt = handle.prepare(sql);
    return {
      all: (params) => stmt.all(params) as SqlRow[],
      get: (params) => stmt.get(params) as SqlRow | undefined,
    };
  };
  try {
    handle.exec("PRAGMA query_only=ON");
    prepare("SELECT count(*) AS n FROM sqlite_master").get({});
  } catch (error) {
    handle.close();
    throw new LibraryDbError(`${dbPath} is not a readable SQLite file: ${describe(error)}`, "not-a-database");
  }
  return adapter(
    "node:sqlite",
    prepare,
    () => {
      handle.close();
    },
    handle,
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Open the library database read-only. A key selects the SQLCipher driver; an
 * encrypted file without a usable cipher module reports
 * `cipher-module-missing` so the caller can switch to the sidecar reader.
 */
export async function openReadOnly(dbPath: string, key?: string): Promise<ReadOnlyDb> {
  if (!existsSync(dbPath)) throw new LibraryDbError(`Rekordbox database not found: ${dbPath}`, "not-found");
  if (key !== undefined) {
    const cipher = await openWithCipher(dbPath, key);
    if (cipher !== undefined) return cipher;
    throw new LibraryDbError(
      `${CIPHER_MODULE} is not installed; the pyrekordbox reader covers this database`,
      "cipher-module-missing",
    );
  }
  try {
    return openWithNodeSqlite(dbPath);
  } catch (error) {
    if (error instanceof LibraryDbError && error.code === "not-a-database") {
      throw new LibraryDbError(`${dbPath} is encrypted; a SQLCipher driver is required`, "not-a-database");
    }
    throw error;
  }
}

/** True when the optional SQLCipher driver is present in this installation. */
export async function cipherDriverAvailable(): Promise<boolean> {
  const specifier = CIPHER_MODULE;
  try {
    const mod: unknown = await import(/* @vite-ignore */ specifier);
    return typeof ctorOf(mod) === "function";
  } catch {
    return false;
  }
}

export const WRITE_PROBE_SQL = "CREATE TABLE autolight_write_probe (x INTEGER)";

interface ExecableHandle {
  exec(sql: string): void;
}

function isExecable(value: unknown): value is ExecableHandle {
  if (typeof value !== "object" || value === null || !("exec" in value)) return false;
  return typeof value.exec === "function";
}

/**
 * Read-only self check (P-4.1-readonly-library, T-SEC-04): attempt a write
 * through the handle's own driver entry point. A read-only open must reject it.
 */
export function attemptWrite(db: ReadOnlyDb, sql = WRITE_PROBE_SQL): { rejected: boolean; error: string | null } {
  if (!isExecable(db.raw)) return { rejected: false, error: "driver handle exposes no write entry point" };
  try {
    db.raw.exec(sql);
    return { rejected: false, error: null };
  } catch (error) {
    return { rejected: true, error: describe(error) };
  }
}

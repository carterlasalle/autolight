// Rekordbox installation discovery and SQLCipher key derivation (T-RBL-01,
// closes F-RBL-01; spec 4.1).
//
// Layouts and the key-blob derivation follow pyrekordbox (MIT) and
// rekordbox-connect (MIT); see THIRD_PARTY_NOTICES and the evidence README.
// The key is a secret: this module never logs it, never returns it from
// diagnostics, and only reports which derivation produced it.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

export type Platform = "darwin" | "win32" | "linux";

export interface PlatformPaths {
  /** Rekordbox agent options.json. */
  optionsPath: string;
  /** Directory holding master.db. */
  dbDir: string;
  /** Directory ANLZ paths are relative to. */
  sharePath: string;
}

// XOR key for the obfuscated database key blob (pyrekordbox utils.BLOB_KEY).
const BLOB_XOR_KEY = "657f48f84c437cc1";
// Obfuscated key blob published by pyrekordbox (db6.database.BLOB).
const OBFUSCATED_KEY_BLOB =
  "PN_Pq^*N>(JYe*u^8;Yg76HuZ<mR13S?=>)b9;DpoTXV(6ItkU`}8*m6tx_I{Solh_N#dfe{v=";

// Python's base64.b85 alphabet (RFC 1924), the encoding pyrekordbox uses.
const BASE85_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";
// CPython pads a partial trailing group with the last alphabet digit and drops
// the same number of bytes from the end of the decoded output.
const BASE85_PAD = "~";
const BASE85_GROUP = 5;
const BASE85_RADIX = 85n;
const BYTE_SHIFTS = [24n, 16n, 8n, 0n] as const;

export function platformPaths(platform: Platform = process.platform as Platform, home = homedir()): PlatformPaths {
  if (platform === "darwin") {
    return {
      optionsPath: join(home, "Library", "Application Support", "Pioneer", "rekordboxAgent", "storage", "options.json"),
      dbDir: join(home, "Library", "Pioneer", "rekordbox"),
      sharePath: join(home, "Library", "Pioneer", "rekordbox", "share"),
    };
  }
  if (platform === "win32") {
    const appData = process.env["APPDATA"] ?? join(home, "AppData", "Roaming");
    return {
      optionsPath: join(appData, "Pioneer", "rekordboxAgent", "storage", "options.json"),
      dbDir: join(appData, "Pioneer", "rekordbox"),
      sharePath: join(appData, "Pioneer", "rekordbox", "share"),
    };
  }
  return {
    optionsPath: join(home, ".Pioneer", "rekordboxAgent", "storage", "options.json"),
    dbDir: join(home, ".Pioneer", "rekordbox"),
    sharePath: join(home, ".Pioneer", "rekordbox", "share"),
  };
}

/** Decode Python's base64.b85 (RFC 1924 alphabet, CPython's padding rule). */
export function base85Decode(text: string): Buffer {
  const padding = (BASE85_GROUP - (text.length % BASE85_GROUP)) % BASE85_GROUP;
  const padded = text + BASE85_PAD.repeat(padding);
  const out: number[] = [];
  for (let i = 0; i < padded.length; i += BASE85_GROUP) {
    let value = 0n;
    for (const ch of padded.slice(i, i + BASE85_GROUP)) {
      const digit = BASE85_ALPHABET.indexOf(ch);
      if (digit < 0) throw new TypeError(`invalid base85 character ${JSON.stringify(ch)} at ${i}`);
      value = value * BASE85_RADIX + BigInt(digit);
    }
    for (const shift of BYTE_SHIFTS) out.push(Number((value >> shift) & 0xffn));
  }
  return Buffer.from(padding === 0 ? out : out.slice(0, out.length - padding));
}

/** Deobfuscate a pyrekordbox key blob: base85, XOR, zlib inflate. */
export function deobfuscateKey(blob = OBFUSCATED_KEY_BLOB): string {
  const raw = base85Decode(blob);
  const key = Buffer.from(BLOB_XOR_KEY, "utf8");
  const xored = Buffer.from(raw.map((byte, i) => byte ^ key[i % key.length]!));
  return inflateSync(xored).toString("utf8");
}

export interface RekordboxOptions {
  options: [string, string][];
}

export function readOptionsFile(path: string): RekordboxOptions {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as RekordboxOptions).options)) {
    throw new TypeError(`options.json has no options array: ${path}`);
  }
  return parsed as RekordboxOptions;
}

export function optionValue(options: RekordboxOptions, key: string): string | undefined {
  return options.options.find((entry) => entry[0] === key)?.[1];
}

export interface LibraryConfig {
  dbPath: string;
  optionsPath: string;
  sharePath: string;
  dbDir: string;
  /** Which derivation produced the SQLCipher key (never the key itself). */
  keySource: "options-dp" | "pyrekordbox-blob" | "explicit";
  key?: string;
  /** True when every path came from detection rather than a config override. */
  detected: boolean;
}

export interface LibraryConfigOverrides {
  dbPath?: string;
  optionsPath?: string;
  sharePath?: string;
  key?: string;
  platform?: Platform;
  home?: string;
}

/** One candidate dbPath/optionsPath resolution, worst case: nothing found. */
export async function resolveLibraryConfig(overrides: LibraryConfigOverrides = {}): Promise<LibraryConfig> {
  const paths = platformPaths(overrides.platform, overrides.home);
  const optionsPath = overrides.optionsPath ?? paths.optionsPath;
  const sharePath = overrides.sharePath ?? paths.sharePath;
  const dbDir = overrides.dbPath ? join(overrides.dbPath, "..") : paths.dbDir;
  let detected = overrides.dbPath === undefined;
  let dbPath = overrides.dbPath;
  let key = overrides.key;
  let keySource: LibraryConfig["keySource"] = overrides.key === undefined ? "pyrekordbox-blob" : "explicit";

  if (existsSync(optionsPath)) {
    const options = readOptionsFile(optionsPath);
    const optionDbPath = optionValue(options, "db-path");
    if (dbPath === undefined && optionDbPath !== undefined && existsSync(optionDbPath)) {
      dbPath = optionDbPath;
      detected = true;
    }
    // rekordbox-connect's route: options.json holds the Blowfish-encrypted
    // password under "dp". Its decryptor is used when the dependency is
    // installed; otherwise the published blob derivation below applies.
    const dp = key === undefined ? optionValue(options, "dp") : undefined;
    if (dp !== undefined) {
      const decrypt = await rekordboxConnectPassword(overrides, optionsPath);
      if (decrypt !== undefined) {
        key = decrypt;
        keySource = "options-dp";
      }
    }
  }
  key ??= deobfuscateKey();
  return {
    dbPath: dbPath ?? join(paths.dbDir, "master.db"),
    optionsPath,
    sharePath,
    dbDir,
    keySource,
    key,
    detected,
  };
}

// rekordbox-connect is an optional runtime dependency (native SQLCipher
// module). Loaded by variable specifier so the package still type-checks and
// runs without it; absent means the caller falls back to the blob derivation
// or to the pyrekordbox sidecar reader.
async function rekordboxConnectPassword(overrides: LibraryConfigOverrides, optionsPath: string): Promise<string | undefined> {
  const specifier = "rekordbox-connect";
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      getRekordboxConfig?: (dbPath?: string, password?: string) => { dbPath: string; password: string };
    };
    if (typeof mod.getRekordboxConfig !== "function") return undefined;
    process.env["REKORDBOX_OPTIONS_PATH"] ??= optionsPath;
    return mod.getRekordboxConfig(overrides.dbPath, overrides.key)?.password;
  } catch {
    return undefined;
  }
}

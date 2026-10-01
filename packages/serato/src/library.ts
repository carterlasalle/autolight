// Serato library plane (T-SER-04, closes F-SER-06; spec 3.1 disk side, 110).
//
// What this reads, all of it read-only by construction (T-SEC-04):
// - `_Serato_/database V2`: the tagged binary library (path, title, artist,
//   BPM, key, and every other field this slice does not model is retained raw,
//   spec 9.5). Field parsing is serato-connect's `parseDatabaseSync`; the
//   retention walk next to it only keeps bytes, it does not decide meanings.
// - `_Serato_/Subcrates/*.crate`: ordered track paths, through serato-connect's
//   `parseCrateSync` so crate order and container handling stay the
//   dependency's job.
// - `_Serato_/SmartCrates/*.scrate`: rules. The record container is the same
//   tag + big-endian length walk the other Serato files use; a record whose
//   payload decodes as `<field> <operator> <value>` is a rule this slice can
//   evaluate, everything else is retained raw and labelled unsupported. The
//   owner's SmartCrates folder is empty and no sample exists on this machine,
//   so this parser is deliberately tolerant and never guesses at a layout it
//   cannot see; HW-SER-01 confirms the real rule records.
//
// Library roots come from `library.serato.root` when set, otherwise
// auto-detection: the default `~/Music/_Serato_` plus every mounted external
// volume that carries its own `_Serato_` folder, merged into one row set.
// Change detection reuses the DS-35 watcher (T-RBL-06) with Serato's file
// classes, so an audio change invalidates only the track that changed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { LibraryWatcher, type NativeWatch, type StatFile, type WatchEngine, type WatchChange, type WatchedFile } from "@autolight/rekordbox-library";
import { detectSeratoInstallation, parseCrateSync, parseDatabaseSync, type SeratoDatabaseTrack } from "serato-connect";

export const SERATO_FOLDER_NAME = "_Serato_";
/** Tag names serato-connect maps into a row; anything else is retained raw. */
const MODELLED_TAGS: Record<string, true> = {
  pfil: true, tsng: true, tart: true, talb: true, tgen: true, tkey: true, tbpm: true,
  tlen: true, tbit: true, tsmp: true, ttyp: true, bbgl: true, bmis: true, uadd: true,
  tcom: true, tgrp: true, tcmp: true, tlbl: true, ttyr: true,
};
const RULE_FIELDS: Record<string, true> = {
  artist: true, title: true, album: true, genre: true, key: true, bpm: true, length: true, filepath: true,
};
const NUMERIC_FIELDS: Record<string, true> = { bpm: true, length: true };
/** Container records that are never rules: the version header. */
const CONTAINER_TAGS: Record<string, true> = { vrsn: true };

export interface SeratoLibraryRoot {
  path: string;
  external: boolean;
  readable: boolean;
}

export interface SeratoTrackRow {
  filePath: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  key?: string;
  bpm?: number;
  length?: number;
  bitrate?: number;
  sampleRate?: number;
  fileType?: string;
  missing?: boolean;
  dateAdded?: string;
  /** Every field this slice does not model, retained as base64 by tag (spec 9.5). */
  rawTags: Record<string, string>;
}

export interface SeratoCrate {
  name: string;
  path: string;
  trackPaths: string[];
}

export interface SeratoSmartCrateRule {
  tag: string;
  field: string;
  operator: string;
  value: string;
  text: string;
}

export interface SeratoSmartCrate {
  name: string;
  path: string;
  rules: SeratoSmartCrateRule[];
  unsupported: { tag: string; payloadBase64: string }[];
}

function isReadable(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** `_Serato_` under the user's Music folder: the default Serato location. */
export function defaultSeratoRoot(home = homedir()): string {
  return join(home, "Music", SERATO_FOLDER_NAME);
}

/**
 * Root candidates in priority order: the configured `library.serato.root` when
 * set, the default folder, then every mounted volume that carries `_Serato_`
 * (external drives have their own). Unreadable candidates are reported, never
 * silently dropped.
 */
export function detectSeratoRoots(opts: {
  configured?: string | null;
  home?: string;
  volumesDir?: string;
} = {}): SeratoLibraryRoot[] {
  const roots: SeratoLibraryRoot[] = [];
  const seen = new Set<string>();
  const push = (path: string, external: boolean): void => {
    if (seen.has(path)) return;
    seen.add(path);
    roots.push({ path, external, readable: isReadable(path) });
  };
  const configured = opts.configured === null || opts.configured === undefined || opts.configured.length === 0
    ? null
    : opts.configured;
  if (configured !== null) push(configured, false);
  push(defaultSeratoRoot(opts.home), false);
  const volumesDir = opts.volumesDir ?? "/Volumes";
  let volumes: string[] = [];
  try {
    volumes = readdirSync(volumesDir);
  } catch {
    volumes = [];
  }
  for (const volume of volumes) push(join(volumesDir, volume, SERATO_FOLDER_NAME), true);
  return roots;
}

/** Detection report for the setup panel: installed, path, version. */
export function seratoInstallation(): { found: boolean; path: string; version: string | null } {
  const detection = detectSeratoInstallation();
  const version = readInstalledVersion();
  return { found: detection.found, path: detection.path, version };
}

function readInstalledVersion(): string | null {
  for (const candidate of ["/Applications/Serato DJ Pro.app/Contents/Info.plist", "/Applications/Serato DJ.app/Contents/Info.plist"]) {
    try {
      const xml = readFileSync(candidate, "utf8");
      const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(xml);
      if (match?.[1] !== undefined) return match[1];
    } catch {
      continue;
    }
  }
  return null;
}

interface WalkedRecord {
  tag: string;
  payload: Buffer;
}

/** Tagged-record walk shared by the database, crates and smart crates. */
function walkRecords(bytes: Buffer, start = 0, end = bytes.length): WalkedRecord[] {
  const records: WalkedRecord[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const tag = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + length > end) break;
    records.push({ tag, payload: bytes.subarray(offset, offset + length) });
    offset += length;
  }
  return records;
}

function decodeUtf16be(bytes: Buffer): string {
  const swapped = Buffer.alloc(bytes.length);
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    swapped[i] = bytes[i + 1] as number;
    swapped[i + 1] = bytes[i] as number;
  }
  return swapped.toString("utf16le").replace(/\0+$/, "");
}

function asRow(track: SeratoDatabaseTrack, rawTags: Record<string, string>): SeratoTrackRow {
  const row: SeratoTrackRow = { filePath: track.filePath, rawTags };
  if (track.title !== undefined) row.title = track.title;
  if (track.artist !== undefined) row.artist = track.artist;
  if (track.album !== undefined) row.album = track.album;
  if (track.genre !== undefined) row.genre = track.genre;
  if (track.key !== undefined) row.key = track.key;
  if (track.bpm !== undefined) row.bpm = track.bpm;
  if (track.length !== undefined) row.length = track.length;
  if (track.bitrate !== undefined) row.bitrate = track.bitrate;
  if (track.sampleRate !== undefined) row.sampleRate = track.sampleRate;
  if (track.fileType !== undefined) row.fileType = track.fileType;
  if (track.missing !== undefined) row.missing = track.missing;
  if (track.dateAdded !== undefined) row.dateAdded = track.dateAdded.toISOString();
  return row;
}

/**
 * Read `database V2`. Field values come from serato-connect; the retention
 * walk adds the raw bytes of every tag the model does not carry, keyed by
 * filePath so a row and its retained bytes line up.
 */
export function readSeratoDatabase(root: string): { rows: SeratoTrackRow[]; retainedTagCount: number } {
  const bytes = readFileSync(join(root, "database V2"));
  const parsed = parseDatabaseSync(join(root, "database V2"));
  const retention = new Map<string, Record<string, string>>();
  for (const record of walkRecords(bytes)) {
    if (record.tag !== "otrk") continue;
    const fields = walkRecords(record.payload, 0, record.payload.length);
    const pathField = fields.find((field) => field.tag === "pfil");
    if (!pathField) continue;
    const filePath = decodeUtf16be(pathField.payload);
    const kept: Record<string, string> = {};
    for (const field of fields) {
      if (MODELLED_TAGS[field.tag] === true) continue;
      kept[field.tag] = field.payload.toString("base64");
    }
    if (Object.keys(kept).length > 0) retention.set(filePath, kept);
  }
  const rows = parsed.map((track) => asRow(track, retention.get(track.filePath) ?? {}));
  return { rows, retainedTagCount: [...retention.values()].reduce((sum, tags) => sum + Object.keys(tags).length, 0) };
}

/** Subcrates in name order; each keeps its own track order (spec: crates order). */
export function readSeratoCrates(root: string): SeratoCrate[] {
  const dir = join(root, "Subcrates");
  let entries: string[] = [];
  try {
    entries = readdirSync(dir).filter((name) => name.endsWith(".crate"));
  } catch {
    return [];
  }
  return entries.sort().map((name) => {
    const path = join(dir, name);
    const crate = parseCrateSync(path);
    return { name, path, trackPaths: crate.trackPaths };
  });
}

/**
 * Smart crates: rules the slice can evaluate, plus every record it cannot,
 * retained raw. An empty `rules` list with a populated `unsupported` list
 * means the file uses a rule layout this build does not know, which the UI
 * shows instead of pretending the crate is empty.
 */
export function readSeratoSmartCrates(root: string): SeratoSmartCrate[] {
  const dir = join(root, "SmartCrates");
  let entries: string[] = [];
  try {
    entries = readdirSync(dir).filter((name) => name.endsWith(".scrate"));
  } catch {
    return [];
  }
  return entries.sort().map((name) => {
    const path = join(dir, name);
    const bytes = readFileSync(path);
    const rules: SeratoSmartCrateRule[] = [];
    const unsupported: { tag: string; payloadBase64: string }[] = [];
    for (const record of walkRecords(bytes)) {
      if (CONTAINER_TAGS[record.tag] === true) continue;
      const rule = parseSmartCrateRule(record.tag, record.payload);
      if (rule) {
        rules.push(rule);
        continue;
      }
      unsupported.push({ tag: record.tag, payloadBase64: record.payload.toString("base64") });
    }
    return { name, path, rules, unsupported };
  });
}

function parseSmartCrateRule(tag: string, payload: Buffer): SeratoSmartCrateRule | null {
  const text = decodeUtf16be(payload).trim();
  const match = /^([A-Za-z]+)\s+(is|contains|equals|>=|<=|>|<)\s+(.+)$/.exec(text);
  if (!match) return null;
  const field = (match[1] ?? "").toLowerCase();
  if (RULE_FIELDS[field] !== true) return null;
  return { tag, field, operator: (match[2] ?? "").toLowerCase(), value: (match[3] ?? "").trim(), text };
}

/**
 * Evaluate a smart crate's rules against library rows. Every rule must match
 * (Serato smart crates are conjunctions of their conditions). Rows whose field
 * is absent never match; unsupported rules are not silently treated as true.
 */
export function evaluateSmartCrate(
  crate: SeratoSmartCrate,
  rows: readonly SeratoTrackRow[],
): { matched: SeratoTrackRow[]; unsupportedRules: number } {
  if (crate.rules.length === 0) return { matched: [], unsupportedRules: crate.unsupported.length };
  const matched = rows.filter((row) => crate.rules.every((rule) => rowMatchesRule(row, rule)));
  return { matched, unsupportedRules: crate.unsupported.length };
}

function rowMatchesRule(row: SeratoTrackRow, rule: SeratoSmartCrateRule): boolean {
  const value = rule.field === "filepath" ? row.filePath : fieldValue(row, rule.field);
  if (value === undefined) return false;
  if (NUMERIC_FIELDS[rule.field] === true) {
    const left = Number(value);
    const right = Number(rule.value);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (rule.operator === ">") return left > right;
    if (rule.operator === "<") return left < right;
    if (rule.operator === ">=") return left >= right;
    if (rule.operator === "<=") return left <= right;
    return left === right;
  }
  const left = String(value).toLowerCase();
  const right = rule.value.toLowerCase();
  if (rule.operator === "contains") return left.includes(right);
  return left === right;
}

function fieldValue(row: SeratoTrackRow, field: string): string | number | undefined {
  if (field === "artist") return row.artist;
  if (field === "title") return row.title;
  if (field === "album") return row.album;
  if (field === "genre") return row.genre;
  if (field === "key") return row.key;
  if (field === "bpm") return row.bpm;
  if (field === "length") return row.length;
  return undefined;
}

/** Merge rows from several roots, keeping the first row for a duplicate path. */
export function mergeSeratoRows(perRoot: readonly SeratoTrackRow[][]): SeratoTrackRow[] {
  const byPath = new Map<string, SeratoTrackRow>();
  for (const rows of perRoot) {
    for (const row of rows) {
      if (!byPath.has(row.filePath)) byPath.set(row.filePath, row);
    }
  }
  return [...byPath.values()];
}

/**
 * Watched files for a Serato root, in the DS-35 shape: the library database
 * and the crate folders are row-level, and each track's audio file is watched
 * per track so a change invalidates only that track's derived artifacts.
 */
export function seratoWatchFiles(root: string, rows: readonly SeratoTrackRow[]): WatchedFile[] {
  const files: WatchedFile[] = [{ path: join(root, "database V2"), kind: "db" }];
  for (const folder of ["Subcrates", "SmartCrates"]) {
    const dir = join(root, folder);
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      entries = [];
    }
    for (const name of entries) files.push({ path: join(dir, name), kind: "db" });
  }
  for (const row of rows) files.push({ path: row.filePath, kind: "audio", trackId: row.filePath });
  return files;
}

export interface SeratoWatchOptions {
  engine?: WatchEngine;
  debounceMs?: number;
  pollMs?: number;
  /** Test seams, forwarded to the shared watcher. */
  native?: NativeWatch;
  statFile?: StatFile;
  nowMs?: () => number;
}

/** The DS-35 watcher over a Serato root (T-RBL-06 machinery, Serato files). */
export function createSeratoWatcher(
  root: string,
  rows: readonly SeratoTrackRow[],
  opts: SeratoWatchOptions = {},
): LibraryWatcher {
  return new LibraryWatcher({
    files: seratoWatchFiles(root, rows),
    engine: opts.engine ?? "auto",
    ...(opts.debounceMs !== undefined ? { debounceMs: opts.debounceMs } : {}),
    ...(opts.pollMs !== undefined ? { pollMs: opts.pollMs } : {}),
    ...(opts.native !== undefined ? { native: opts.native } : {}),
    ...(opts.statFile !== undefined ? { statFile: opts.statFile } : {}),
    ...(opts.nowMs !== undefined ? { nowMs: opts.nowMs } : {}),
  });
}

export type { WatchChange, WatchedFile };

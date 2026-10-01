// Library change detection and selective invalidation (T-RBL-06, closes
// F-RBL-10; probe P-141-watch).
//
// Three things are watched: master.db, master.db-wal (a WAL-aware reader sees
// Rekordbox's committed edits, so a WAL write is a library change), each
// track's ANLZ set (mtime and size) and each audio file (mtime and size, then a
// hash when either moved). Two engines behind DS-35:
//
//   native-events  OS events (@parcel/watcher when installed, else fs.watch)
//   polling        stat sweep, the only engine that works on network drives
//   auto           native events plus a slow sweep whose findings the events
//                  missed are counted for Diagnostics
//
// Invalidation is selective: a grid or PSSI change drops the native analysis
// part and the plan, an audio change drops everything derived for that track,
// and a title edit drops nothing but the row cache.
import { realpathSync as fsRealpathSync, statSync as fsStatSync, watch as fsWatch } from "node:fs";
import type { FSWatcher } from "node:fs";
import type { StatFile } from "./anlz.js";

export type WatchEngine = "auto" | "native-events" | "polling";
export type WatchSource = "native" | "poll" | "manual";
export type WatchedKind = "db" | "wal" | "anlz" | "audio";

export interface WatchedFile {
  path: string;
  kind: WatchedKind;
  /** Library track the file belongs to, when known. */
  trackId?: string;
}

export interface FileSnapshot {
  path: string;
  kind: WatchedKind;
  sizeBytes: number | null;
  mtimeMs: number | null;
}

export interface WatchChange {
  atMs: number;
  source: WatchSource;
  files: WatchedFile[];
  invalidated: InvalidationScope[];
}

export type InvalidationScope = "row" | "identity" | "native-analysis" | "model" | "plan" | "audio-derived";

export const DEFAULT_DEBOUNCE_MS = 2000;
export const DEFAULT_POLL_MS = 60_000;
/** Best-effort canonical path: falls back to the raw path when missing. */
function canonicalPath(path: string): string {
  try {
    return fsRealpathSync(path);
  } catch {
    return path;
  }
}

// Columns that change what the native analysis and the plan were built from.
const ANALYSIS_COLUMNS: Record<string, true> = {
  AnalysisDataPath: true,
  BPM: true,
  Analysed: true,
  AnalysisUpdated: true,
  CueUpdated: true,
};
// Path columns change identity (a move or rename keeps the TrackId, the alias
// graph follows the new path).
const IDENTITY_COLUMNS: Record<string, true> = { FolderPath: true, OrgFolderPath: true, rb_LocalFolderPath: true };

export interface LibraryRowSnapshot {
  rekordboxId: string;
  columns: Record<string, unknown>;
}

export interface LibraryRowDiff {
  added: string[];
  removed: string[];
  changed: { rekordboxId: string; columns: string[] }[];
}

export interface NativeWatch {
  start(files: readonly WatchedFile[], onEvent: (path: string) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface LibraryWatcherOptions {
  files: readonly WatchedFile[];
  engine: WatchEngine;
  debounceMs?: number;
  pollMs?: number;
  /** Test seam: replaces fs.statSync. */
  statFile?: StatFile;
  /** Test seam: replaces the OS event engine. */
  native?: NativeWatch;
  nowMs?: () => number;
}

function defaultStat(path: string): { sizeBytes: number; mtimeMs: number } | undefined {
  try {
    const stats = fsStatSync(path);
    return { sizeBytes: stats.size, mtimeMs: stats.mtimeMs };
  } catch {
    return undefined;
  }
}

export class LibraryWatcher {
  private readonly files: readonly WatchedFile[];
  private readonly engine: WatchEngine;
  private readonly debounceMs: number;
  private readonly pollMs: number;
  private readonly statFile: StatFile;
  private readonly nowMs: () => number;
  private native: NativeWatch | undefined;
  private nativeReported: Set<string> = new Set<string>();
  private missed = 0;
  private snapshots: FileSnapshot[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private listeners: ((change: WatchChange) => void)[] = [];
  private pending: WatchedFile[] = [];

  constructor(options: LibraryWatcherOptions) {
    this.files = options.files;
    this.engine = options.engine;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.statFile = options.statFile ?? defaultStat;
    this.native = options.native;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.snapshots = this.readSnapshots();
  }

  on(listener: (change: WatchChange) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }

  async start(): Promise<void> {
    if (this.engine !== "polling") {
      this.native ??= await createNativeWatch();
      await this.native.start(this.files, (path) => {
        this.nativeReported.add(path);
        this.queue(this.files.filter((file) => file.path === path), "native");
      });
    }
    if (this.engine !== "native-events") {
      this.interval = setInterval(() => {
        this.sweep();
      }, this.pollMs);
    }
  }

  async stop(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer);
    if (this.interval !== undefined) clearInterval(this.interval);
    this.timer = undefined;
    this.interval = undefined;
    await this.native?.stop();
  }

  /** Changes the polling engine found that OS events never reported. */
  missedChanges(): number {
    return this.missed;
  }

  /** One polling pass. Returns the change when anything moved. */
  sweep(source: WatchSource = "poll"): WatchChange | undefined {
    const next = this.readSnapshots();
    const changed: WatchedFile[] = [];
    let missedNow = 0;
    for (let i = 0; i < next.length; i++) {
      const before = this.snapshots[i];
      const after = next[i]!;
      if (before === undefined) continue;
      if (before.sizeBytes !== after.sizeBytes || before.mtimeMs !== after.mtimeMs) {
        changed.push({ path: after.path, kind: after.kind, ...(this.trackOf(after.path) ?? {}) });
        if (!this.nativeReported.has(after.path)) missedNow++;
      }
    }
    this.snapshots = next;
    this.nativeReported.clear();
    if (changed.length === 0) return undefined;
    if (this.engine === "auto") this.missed += missedNow;
    return this.emit(changed, source);
  }

  /** Feed a change by hand (tests, and callers that already know a path moved). */
  report(files: WatchedFile[], source: WatchSource = "manual"): WatchChange {
    this.snapshots = this.readSnapshots();
    return this.emit(files, source);
  }

  private trackOf(path: string): { trackId?: string } {
    const found = this.files.find((file) => file.path === path && file.trackId !== undefined);
    return found?.trackId === undefined ? {} : { trackId: found.trackId };
  }

  private readSnapshots(): FileSnapshot[] {
    return this.files.map((file) => {
      const stats = this.statFile(file.path);
      return {
        path: file.path,
        kind: file.kind,
        sizeBytes: stats?.sizeBytes ?? null,
        mtimeMs: stats?.mtimeMs ?? null,
      };
    });
  }

  // Debounce: OS events arrive in bursts while Rekordbox writes, so one
  // trailing edge reports them (library.watch.debounceMs).
  private queue(files: WatchedFile[], source: WatchSource): void {
    this.pending.push(...files);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const pending = this.pending;
      this.pending = [];
      this.timer = undefined;
      if (pending.length > 0) this.emit(pending, source);
    }, this.debounceMs);
  }

  private emit(files: WatchedFile[], source: WatchSource): WatchChange {
    const change: WatchChange = {
      atMs: this.nowMs(),
      source,
      files,
      invalidated: invalidationForFiles(files),
    };
    for (const listener of this.listeners) listener(change);
    return change;
  }
}

/** Which artifacts a set of changed files invalidates. */
export function invalidationForFiles(files: readonly WatchedFile[]): InvalidationScope[] {
  const scopes: Partial<Record<InvalidationScope, true>> = {};
  for (const file of files) {
    scopes["row"] = true;
    if (file.kind === "anlz") {
      scopes["native-analysis"] = true;
      scopes["model"] = true;
      scopes["plan"] = true;
    }
    if (file.kind === "audio") {
      scopes["audio-derived"] = true;
      scopes["native-analysis"] = true;
      scopes["model"] = true;
      scopes["plan"] = true;
    }
  }
  return (Object.keys(scopes) as InvalidationScope[]).sort();
}

/** Row-level diff of two library snapshots (added, removed, changed columns). */
export function diffLibraryRows(prev: readonly LibraryRowSnapshot[], next: readonly LibraryRowSnapshot[]): LibraryRowDiff {
  const before = new Map(prev.map((row) => [row.rekordboxId, row.columns]));
  const afterIds = new Set(next.map((row) => row.rekordboxId));
  const added: string[] = [];
  const changed: { rekordboxId: string; columns: string[] }[] = [];
  for (const row of next) {
    const old = before.get(row.rekordboxId);
    if (old === undefined) {
      added.push(row.rekordboxId);
      continue;
    }
    const columns = Object.keys(row.columns).filter((column) => old[column] !== row.columns[column]);
    if (columns.length > 0) changed.push({ rekordboxId: row.rekordboxId, columns });
  }
  const removed = [...before.keys()].filter((id) => !afterIds.has(id));
  return { added, removed, changed };
}

/** Which artifacts a row diff invalidates, per column class. */
export function invalidationForDiff(diff: LibraryRowDiff): InvalidationScope[] {
  const scopes: Partial<Record<InvalidationScope, true>> = {};
  if (diff.added.length > 0 || diff.removed.length > 0) {
    scopes["row"] = true;
    scopes["identity"] = true;
  }
  for (const row of diff.changed) {
    scopes["row"] = true;
    if (row.columns.some((column) => ANALYSIS_COLUMNS[column] === true)) {
      scopes["native-analysis"] = true;
      scopes["model"] = true;
      scopes["plan"] = true;
    }
    if (row.columns.some((column) => IDENTITY_COLUMNS[column] === true)) scopes["identity"] = true;
  }
  return (Object.keys(scopes) as InvalidationScope[]).sort();
}

export const PARCEL_WATCHER_MODULE = "@parcel/watcher";

type ParcelSubscription = { unsubscribe(): Promise<void> };
interface ParcelWatcherModule {
  subscribe(
    dir: string,
    callback: (error: Error | null, events: { path: string }[]) => void,
    options: { ignore: string[] },
  ): Promise<ParcelSubscription>;
}

// OS event engine. @parcel/watcher is an optional native dependency, so the
// specifier is a runtime variable; without it fs.watch delivers the same OS
// events for the handful of files this watcher holds.
export async function createNativeWatch(): Promise<NativeWatch> {
  const specifier = PARCEL_WATCHER_MODULE;
  try {
    const mod: unknown = await import(/* @vite-ignore */ specifier);
    const parcel = mod as Partial<ParcelWatcherModule>;
    if (typeof parcel.subscribe === "function") return new ParcelWatcher(parcel as ParcelWatcherModule);
  } catch {
    // fall through to fs.watch
  }
  return new FsWatcher();
}

class ParcelWatcher implements NativeWatch {
  private subscriptions: ParcelSubscription[] = [];
  private readonly parcel: ParcelWatcherModule;

  constructor(parcel: ParcelWatcherModule) {
    this.parcel = parcel;
  }

  async start(files: readonly WatchedFile[], onEvent: (path: string) => void): Promise<void> {
    // @parcel/watcher resolves symlinks in event paths (on macOS /var is a
    // symlink to /private/var), so match on the canonical path as well as
    // the raw path. The callback still receives the original watched path so
    // downstream path filtering keeps working.
    const canonical = new Map(files.map((file) => [file.path, canonicalPath(file.path)] as const));
    const dirs = new Set(files.map((file) => file.path.slice(0, file.path.lastIndexOf("/"))));
    for (const dir of dirs) {
      const subscription = await this.parcel.subscribe(
        dir,
        (_error, events) => {
          for (const event of events) {
            const resolved = canonicalPath(event.path);
            const match = files.find((file) => file.path === event.path || canonical.get(file.path) === resolved);
            if (match !== undefined) onEvent(match.path);
          }
        },
        { ignore: [] },
      );
      this.subscriptions.push(subscription);
    }
  }

  async stop(): Promise<void> {
    const subscriptions = this.subscriptions;
    this.subscriptions = [];
    for (const subscription of subscriptions) await subscription.unsubscribe();
  }
}

class FsWatcher implements NativeWatch {
  private watchers: FSWatcher[] = [];

  start(files: readonly WatchedFile[], onEvent: (path: string) => void): Promise<void> {
    for (const file of files) {
      try {
        const watcher = fsWatch(file.path, () => {
          onEvent(file.path);
        });
        watcher.on("error", () => {
          watcher.close();
        });
        this.watchers.push(watcher);
      } catch {
        // A path that does not exist (removed audio, unmounted volume) is
        // reported by the polling sweep instead.
      }
    }
    return Promise.resolve();
  }

  stop(): Promise<void> {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    return Promise.resolve();
  }
}

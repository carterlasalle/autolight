// Library service: the reader modes of DS-15 and the typed queries the main
// process exposes (T-RBL-01, T-RBL-02, T-RBL-06; spec 4.1, §5, §12, §141).
//
//   rekordbox-connect  the TypeScript reader: authoritative
//   pyrekordbox        the uv sidecar: used when the TypeScript reader cannot
//                      open the database (no SQLCipher native module)
//   auto               TypeScript reader, with the sidecar cross-checking row
//                      counts, playlist membership and sample paths for
//                      Diagnostics
//
// The service owns the reader and the watcher, and it never writes: the only
// handles it holds are read-only.
import {
  RekordboxReader,
  mapHistoryRow,
  mapPlaylistRow,
  mapTrackRow,
  type LibraryCounts,
  type LibraryHistorySession,
  type LibraryPlaylist,
  type LibrarySource,
  type LibraryTrack,
  type PlaylistEntry,
  type TrackQuery,
} from "./db.js";
import { LibraryDbError, type SqlRow } from "./driver.js";
import { readLibraryViaSidecar, SidecarReader, type SidecarCommand, type SidecarResult, type SidecarRunner } from "./sidecar.js";
import {
  diffLibraryRows,
  invalidationForDiff,
  LibraryWatcher,
  type InvalidationScope,
  type LibraryRowSnapshot,
  type NativeWatch,
  type WatchChange,
  type WatchEngine,
  type WatchedFile,
} from "./watch.js";
import type { StatFile } from "./anlz.js";

export type ReaderMode = "rekordbox-connect" | "pyrekordbox" | "auto";
export type ActiveReader = "rekordbox-connect" | "pyrekordbox";

/** Rows the service reads for snapshots and diagnostics. */
export const SNAPSHOT_LIMIT = 5000;
const DEFAULT_ENGINE: WatchEngine = "auto";

export interface LibraryServiceConfig {
  dbPath: string;
  sharePath: string;
  mode?: ReaderMode;
  key?: string;
  /** False for an unencrypted fixture database. */
  encrypted?: boolean;
  crossCheck?: boolean;
  watch?: { engine?: WatchEngine; debounceMs?: number; pollMs?: number; native?: NativeWatch };
  statFile?: StatFile;
  sidecar?: { run?: SidecarRunner; command?: SidecarCommand; timeoutMs?: number };
  nowMs?: () => number;
}

export interface CrossCheck {
  status: "agree" | "disagree" | "unavailable" | "disabled";
  ts?: LibraryCounts;
  py?: LibraryCounts;
  mismatches: string[];
  note?: string;
  durationMs?: number;
}

export interface LibraryDiagnostics {
  mode: ReaderMode;
  activeReader: ActiveReader;
  driver: string;
  dbVersion: string | null;
  counts: LibraryCounts;
  crossCheck: CrossCheck;
  watcher: { engine: WatchEngine; missedChanges: number; watchedFiles: number };
  anlz: { ok: number; partial: number; missing: number; audioMissing: number };
}

export interface LibraryPage {
  rows: LibraryTrack[];
  total: number;
}

export interface LibraryChangeEvent extends WatchChange {
  diff: { added: string[]; removed: string[]; changed: { rekordboxId: string; columns: string[] }[] } | null;
}

interface ResolvedConfig extends LibraryServiceConfig {
  mode: ReaderMode;
  crossCheck: boolean;
}

export class LibraryService {
  private readonly settings: ResolvedConfig;
  private readonly source: LibrarySource;
  private readonly activeReader: ActiveReader;
  private watcher: LibraryWatcher | undefined;
  private watcherFiles: WatchedFile[] = [];
  private crossCheckResult: CrossCheck;
  private rowSnapshot: LibraryRowSnapshot[] = [];
  private listeners: ((change: LibraryChangeEvent) => void)[] = [];

  private constructor(config: ResolvedConfig, source: LibrarySource, activeReader: ActiveReader) {
    this.settings = config;
    this.source = source;
    this.activeReader = activeReader;
    this.crossCheckResult = !config.crossCheck
      ? { status: "disabled", mismatches: [] }
      : activeReader === "pyrekordbox"
        ? { status: "disabled", mismatches: [], note: "pyrekordbox is the active reader" }
        : { status: "unavailable", mismatches: [], note: "not run" };
  }

  static async open(config: LibraryServiceConfig): Promise<LibraryService> {
    const resolved: ResolvedConfig = { ...config, mode: config.mode ?? "auto", crossCheck: config.crossCheck ?? true };
    if (resolved.mode === "pyrekordbox") {
      return new LibraryService(resolved, await openSidecar(resolved), "pyrekordbox");
    }
    try {
      const reader = await RekordboxReader.open({
        dbPath: resolved.dbPath,
        sharePath: resolved.sharePath,
        ...(resolved.key === undefined ? {} : { key: resolved.key }),
        ...(resolved.statFile === undefined ? {} : { statFile: resolved.statFile }),
      });
      return new LibraryService(resolved, reader, "rekordbox-connect");
    } catch (error) {
      const recoverable =
        error instanceof LibraryDbError && (error.code === "cipher-module-missing" || error.code === "not-a-database");
      if (resolved.mode !== "auto" || !recoverable) throw error;
      return new LibraryService(resolved, await openSidecar(resolved), "pyrekordbox");
    }
  }

  get mode(): ReaderMode {
    return this.settings.mode;
  }

  get reader(): ActiveReader {
    return this.activeReader;
  }

  tracks(query: TrackQuery = {}): LibraryPage {
    return {
      rows: this.source.trackRows(query).map((row) => this.normalize(row)),
      total: this.source.trackCount(query.search),
    };
  }

  track(rekordboxId: string): LibraryTrack | undefined {
    const row = this.source.trackRow(rekordboxId);
    return row === undefined ? undefined : this.normalize(row);
  }

  playlists(): LibraryPlaylist[] {
    return this.source.playlistRows().map(mapPlaylistRow);
  }

  playlistTracks(playlistId: string): LibraryTrack[] {
    return this.tracksForEntries(this.source.songPlaylistRows(playlistId));
  }

  history(): LibraryHistorySession[] {
    const rows = this.source.historyRows();
    return rows.map((row) => mapHistoryRow(row, this.source.songHistoryRows(String(row["ID"] ?? "")).length));
  }

  historyTracks(historyId: string): LibraryTrack[] {
    return this.tracksForEntries(this.source.songHistoryRows(historyId));
  }

  onChanged(listener: (change: LibraryChangeEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }

  /** Register master.db, its WAL and the files of the tracks the UI loaded. */
  watchTracks(tracks: readonly LibraryTrack[]): WatchedFile[] {
    const files: WatchedFile[] = [
      { path: this.settings.dbPath, kind: "db" },
      { path: `${this.settings.dbPath}-wal`, kind: "wal" },
    ];
    for (const track of tracks) {
      for (const file of [track.anlz.dat, track.anlz.ext, track.anlz.ex2]) {
        if (file !== null) files.push({ path: file.path, kind: "anlz", trackId: track.rekordboxId });
      }
      if (track.filePath !== null) files.push({ path: track.filePath, kind: "audio", trackId: track.rekordboxId });
    }
    this.watcherFiles = files;
    return files;
  }

  async startWatching(): Promise<void> {
    if (this.watcherFiles.length === 0) return;
    this.watcher = new LibraryWatcher({
      files: this.watcherFiles,
      engine: this.settings.watch?.engine ?? DEFAULT_ENGINE,
      ...(this.settings.watch?.debounceMs === undefined ? {} : { debounceMs: this.settings.watch.debounceMs }),
      ...(this.settings.watch?.pollMs === undefined ? {} : { pollMs: this.settings.watch.pollMs }),
      ...(this.settings.watch?.native === undefined ? {} : { native: this.settings.watch.native }),
      ...(this.settings.statFile === undefined ? {} : { statFile: this.settings.statFile }),
      ...(this.settings.nowMs === undefined ? {} : { nowMs: this.settings.nowMs }),
    });
    this.rowSnapshot = this.snapshotRows();
    this.watcher.on((change) => {
      const next = this.snapshotRows();
      const diff = diffLibraryRows(this.rowSnapshot, next);
      this.rowSnapshot = next;
      const invalidated = [
        ...new Set<InvalidationScope>([...change.invalidated, ...invalidationForDiff(diff)]),
      ].sort() as InvalidationScope[];
      const empty = diff.added.length + diff.removed.length + diff.changed.length === 0;
      const event: LibraryChangeEvent = { ...change, invalidated, diff: empty ? null : diff };
      for (const listener of this.listeners) listener(event);
    });
    await this.watcher.start();
  }

  /** Missed-change counter from the safety sweep (T-RBL-06, P-141-watch). */
  missedChanges(): number {
    return this.watcher?.missedChanges() ?? 0;
  }

  async stopWatching(): Promise<void> {
    await this.watcher?.stop();
    this.watcher = undefined;
  }

  /** Cross-check the TypeScript reader against the pyrekordbox sidecar (DS-15). */
  async runCrossCheck(): Promise<CrossCheck> {
    if (!this.settings.crossCheck) return { status: "disabled", mismatches: [] };
    if (this.activeReader === "pyrekordbox") {
      this.crossCheckResult = { status: "disabled", mismatches: [], note: "pyrekordbox is the active reader" };
      return this.crossCheckResult;
    }
    const result = await readLibraryViaSidecar(
      {
        dbPath: this.settings.dbPath,
        encrypted: this.settings.encrypted ?? true,
        ...(this.settings.key === undefined ? {} : { key: this.settings.key }),
        limit: SNAPSHOT_LIMIT,
      },
      this.settings.sidecar ?? {},
    );
    if (!result.ok) {
      this.crossCheckResult = {
        status: "unavailable",
        mismatches: [],
        durationMs: result.durationMs,
        ...(result.error === undefined ? {} : { note: result.error }),
      };
      return this.crossCheckResult;
    }
    const mismatches = this.compareWithSidecar(result);
    this.crossCheckResult = {
      status: mismatches.length === 0 ? "agree" : "disagree",
      ts: this.source.counts(),
      ...(result.counts === undefined ? {} : { py: result.counts }),
      mismatches,
      durationMs: result.durationMs,
    };
    return this.crossCheckResult;
  }

  diagnostics(): LibraryDiagnostics {
    return {
      mode: this.mode,
      activeReader: this.activeReader,
      driver: this.source.driver,
      dbVersion: this.source.dbVersion(),
      counts: this.source.counts(),
      crossCheck: this.crossCheckResult,
      watcher: {
        engine: this.settings.watch?.engine ?? DEFAULT_ENGINE,
        missedChanges: this.missedChanges(),
        watchedFiles: this.watcherFiles.length,
      },
      anlz: summariseAnlz(this.tracks({ limit: SNAPSHOT_LIMIT }).rows),
    };
  }

  async close(): Promise<void> {
    await this.stopWatching();
    this.source.close();
  }

  private normalize(row: SqlRow): LibraryTrack {
    return mapTrackRow(
      row,
      this.settings.statFile === undefined
        ? { sharePath: this.settings.sharePath }
        : { sharePath: this.settings.sharePath, statFile: this.settings.statFile },
    );
  }

  private tracksForEntries(entries: readonly PlaylistEntry[]): LibraryTrack[] {
    const rows: LibraryTrack[] = [];
    for (const entry of entries) {
      const track = this.track(entry.rekordboxId);
      if (track !== undefined) rows.push(track);
    }
    return rows;
  }

  private snapshotRows(): LibraryRowSnapshot[] {
    return this.source.trackRows({ limit: SNAPSHOT_LIMIT }).map((row) => {
      const columns: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) columns[key] = value;
      return { rekordboxId: String(row["ID"] ?? ""), columns };
    });
  }

  // Counts, playlist membership and a sample of ANLZ paths, per DS-15.
  private compareWithSidecar(result: SidecarResult): string[] {
    const mismatches: string[] = [];
    const ts = this.source.counts();
    if (result.counts !== undefined) {
      for (const key of ["tracks", "playlists", "historySessions", "historyEntries"] as const) {
        if (ts[key] !== result.counts[key]) mismatches.push(`${key}: ts=${ts[key]} py=${result.counts[key]}`);
      }
    }
    const tsPlaylists = new Map(this.playlists().map((playlist) => [playlist.id, playlist]));
    for (const row of result.playlists ?? []) {
      const id = String(row["ID"] ?? "");
      const mine = tsPlaylists.get(id);
      if (mine === undefined) {
        mismatches.push(`playlist ${id} missing from the TypeScript reader`);
        continue;
      }
      if (mine.name !== String(row["Name"] ?? "")) mismatches.push(`playlist ${id} name differs`);
      const pyCount = (result.songPlaylists ?? []).filter((entry) => String(entry.PlaylistID ?? "") === id).length;
      if (this.source.songPlaylistRows(id).length !== pyCount) mismatches.push(`playlist ${id} membership differs`);
    }
    for (const row of result.tracks ?? []) {
      const id = String(row["ID"] ?? "");
      const mine = this.source.trackRow(id);
      if (mine === undefined) {
        mismatches.push(`track ${id} missing from the TypeScript reader`);
        continue;
      }
      if (String(mine["AnalysisDataPath"] ?? "") !== String(row["AnalysisDataPath"] ?? "")) {
        mismatches.push(`track ${id} analysis path differs`);
      }
    }
    return mismatches;
  }
}

function summariseAnlz(tracks: readonly LibraryTrack[]): LibraryDiagnostics["anlz"] {
  const summary = { ok: 0, partial: 0, missing: 0, audioMissing: 0 };
  for (const track of tracks) {
    if (track.anlz.statuses.includes("anlz-ok")) summary.ok++;
    if (track.anlz.statuses.includes("anlz-partial")) summary.partial++;
    if (track.anlz.statuses.includes("anlz-missing")) summary.missing++;
    if (track.anlz.statuses.includes("audio-missing")) summary.audioMissing++;
  }
  return summary;
}

async function openSidecar(config: ResolvedConfig): Promise<SidecarReader> {
  return SidecarReader.open({
    dbPath: config.dbPath,
    encrypted: config.encrypted ?? true,
    ...(config.key === undefined ? {} : { key: config.key }),
    limit: SNAPSHOT_LIMIT,
    ...(config.sidecar ?? {}),
  });
}

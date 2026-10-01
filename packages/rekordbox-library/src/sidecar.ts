// pyrekordbox sidecar reader (T-RBL-01, DS-15 second mode).
//
// The analysis worker (uv) is asked for the same raw rows the TypeScript reader
// selects, so `mapTrackRow` produces identical normalized output in every
// reader mode. It opens the database through sqlcipher3 (pyrekordbox's key blob
// when no key is supplied) with a read-only URI and `query_only`, so a write
// attempt is rejected by SQLite itself.
//
// Command contract: `library-read` JSON on stdin, one JSON object on stdout.
// The script lives here while the analysis worker owns no library command; the
// same contract is what the worker's `library-read` op must implement and the
// evidence README records that hand-off.
//
// `uv` is located, not bundled: T-OPS-05 ships the interpreter the packaged app
// runs. A missing interpreter surfaces as a typed result, never a throw.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { LibraryCounts, LibrarySource, PlaylistEntry, TrackQuery } from "./db.js";
import type { SqlRow } from "./driver.js";

export interface SidecarRequest {
  dbPath: string;
  /** False for an unencrypted fixture database: the script skips the key. */
  encrypted?: boolean;
  /** SQLCipher key; omitted lets the script derive pyrekordbox's blob key. */
  key?: string;
  /** Maximum track rows to return. */
  limit?: number;
  /** Ask the script to attempt a write and report the rejection. */
  probeWrite?: boolean;
}

export interface SidecarPayload {
  ok: boolean;
  counts?: LibraryCounts;
  dbVersion?: string | null;
  tracks?: SqlRow[];
  playlists?: SqlRow[];
  songPlaylists?: (SqlRow & { PlaylistID: string; ContentID: string; TrackNo: number })[];
  history?: SqlRow[];
  songHistory?: (SqlRow & { HistoryID: string; ContentID: string; TrackNo: number })[];
  writeProbe?: { rejected: boolean; error: string | null };
  error?: string;
}

export interface SidecarResult extends SidecarPayload {
  durationMs: number;
}

export interface SidecarCommand {
  command: string;
  args: string[];
}

export interface SidecarRun {
  code: number;
  stdout: string;
  stderr: string;
}

export type SidecarRunner = (command: SidecarCommand, stdin: string) => Promise<SidecarRun>;

export const SIDECAR_TIMEOUT_MS = 30_000;
export const SIDECAR_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export const SIDECAR_SCRIPT = String.raw`"""Read-only Rekordbox library reader (autolight sidecar protocol)."""
import json
import sys

TRACK_SELECT = """select c.*,
         ar.Name as artistName,
         al.Name as albumName,
         ge.Name as genreName,
         k.ScaleName as keyName,
         co.Commnt as colorName
  from djmdContent c
  left join djmdArtist ar on c.ArtistID = ar.ID
  left join djmdAlbum al on c.AlbumID = al.ID
  left join djmdGenre ge on c.GenreID = ge.ID
  left join djmdKey k on c.KeyID = k.ID
  left join djmdColor co on c.ColorID = co.ID
  order by c.ID limit ?"""


def rows(cur, sql, params=()):
    cur.execute(sql, params)
    names = [d[0] for d in cur.description]
    return [dict(zip(names, row)) for row in cur.fetchall()]


def main() -> int:
    req = json.loads(sys.stdin.read())
    db_path = req["dbPath"]
    encrypted = bool(req.get("encrypted", True))
    key = req.get("key")
    if encrypted and not key:
        from pyrekordbox.db6.database import BLOB
        from pyrekordbox.utils import deobfuscate

        key = deobfuscate(BLOB)
    try:
        from sqlcipher3 import dbapi2 as driver
    except ImportError:
        import sqlite3 as driver
    con = driver.connect("file:%s?mode=ro" % db_path, uri=True)
    if encrypted:
        con.execute("PRAGMA key='%s'" % key)
    con.execute("PRAGMA query_only=ON")
    cur = con.cursor()
    out = {"ok": True}
    counts = {}
    for name, table in (
        ("tracks", "djmdContent"),
        ("playlists", "djmdPlaylist"),
        ("historySessions", "djmdHistory"),
        ("historyEntries", "djmdSongHistory"),
    ):
        cur.execute("select count(*) from %s" % table)
        counts[name] = cur.fetchone()[0]
    out["counts"] = counts
    cur.execute("select DBVersion from djmdProperty limit 1")
    version = cur.fetchone()
    out["dbVersion"] = version[0] if version else None
    out["tracks"] = rows(cur, TRACK_SELECT, (int(req.get("limit", 5000)),))
    out["playlists"] = rows(cur, "select * from djmdPlaylist order by Seq")
    out["songPlaylists"] = rows(
        cur, "select PlaylistID, ContentID, TrackNo from djmdSongPlaylist order by PlaylistID, TrackNo"
    )
    out["history"] = rows(cur, "select * from djmdHistory order by Seq")
    out["songHistory"] = rows(
        cur, "select HistoryID, ContentID, TrackNo from djmdSongHistory order by HistoryID, TrackNo"
    )
    if req.get("probeWrite"):
        try:
            con.execute("create table autolight_write_probe (x integer)")
            out["writeProbe"] = {"rejected": False, "error": None}
        except Exception as exc:  # noqa: BLE001 - the rejection itself is the result
            out["writeProbe"] = {"rejected": True, "error": "%s: %s" % (type(exc).__name__, exc)}
    con.close()
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`;

// The uv project is resolved against the repository layout, not the process
// working directory: the packaged app and the test runner start elsewhere.
export const ANALYSIS_PROJECT = fileURLToPath(new URL("../../../analysis", import.meta.url));

export const DEFAULT_SIDECAR_COMMAND: SidecarCommand = {
  command: "uv",
  args: ["run", "--project", ANALYSIS_PROJECT, "python", "-c", SIDECAR_SCRIPT],
};

export function runSidecarProcess(command: SidecarCommand, stdin: string, timeoutMs = SIDECAR_TIMEOUT_MS): Promise<SidecarRun> {
  return new Promise<SidecarRun>((resolve, reject) => {
    const child = spawn(command.command, command.args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`sidecar timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > SIDECAR_MAX_OUTPUT_BYTES) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

function isSidecarPayload(value: unknown): value is SidecarPayload {
  if (typeof value !== "object" || value === null || !("ok" in value)) return false;
  return typeof value.ok === "boolean";
}

// A script that reports its own failure on stdout keeps the message; JSON.parse
// is guarded because stdout may hold tracebacks instead.
function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function parsePayloadError(line: string): string | undefined {
  const parsed = parseJsonLine(line);
  if (typeof parsed !== "object" || parsed === null || !("error" in parsed)) return undefined;
  return typeof parsed.error === "string" ? parsed.error : undefined;
}

/** Ask the pyrekordbox sidecar for library rows. Never throws. */
export async function readLibraryViaSidecar(
  request: SidecarRequest,
  options: { run?: SidecarRunner; command?: SidecarCommand; timeoutMs?: number } = {},
): Promise<SidecarResult> {
  const startedAt = Date.now();
  const run = options.run ?? ((command: SidecarCommand, stdin: string) => runSidecarProcess(command, stdin, options.timeoutMs));
  try {
    const result = await run(options.command ?? DEFAULT_SIDECAR_COMMAND, JSON.stringify(request));
    const lastLine = result.stdout.trim().split("\n").pop() ?? "null";
    if (result.code !== 0) {
      const reported = parsePayloadError(lastLine);
      const detail = reported ?? (result.stderr.trim().split("\n").slice(-1)[0] ?? "");
      return { ok: false, error: `sidecar exited ${result.code}: ${detail.slice(0, 400)}`, durationMs: Date.now() - startedAt };
    }
    const parsed = parseJsonLine(lastLine);
    if (parsed === undefined || !isSidecarPayload(parsed)) {
      return { ok: false, error: "sidecar returned an unexpected payload", durationMs: Date.now() - startedAt };
    }
    return { ...parsed, durationMs: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, durationMs: Date.now() - startedAt };
  }
}

export interface SidecarReaderConfig extends SidecarRequest {
  run?: SidecarRunner;
  command?: SidecarCommand;
  timeoutMs?: number;
}

// The dump is loaded once (one interpreter start) and queried in memory: the
// sidecar mode only runs when the TypeScript reader cannot open the database.
export class SidecarReader implements LibrarySource {
  readonly driver = "pyrekordbox-sidecar";
  readonly durationMs: number;
  private readonly payload: SidecarPayload;
  private readonly request: SidecarRequest;
  private readonly options: { run?: SidecarRunner; command?: SidecarCommand; timeoutMs?: number };

  private constructor(
    payload: SidecarPayload,
    durationMs: number,
    request: SidecarRequest,
    options: { run?: SidecarRunner; command?: SidecarCommand; timeoutMs?: number },
  ) {
    this.payload = payload;
    this.durationMs = durationMs;
    this.request = request;
    this.options = options;
  }

  static async open(config: SidecarReaderConfig): Promise<SidecarReader> {
    const { run, command, timeoutMs, ...request } = config;
    const options = {
      ...(run === undefined ? {} : { run }),
      ...(command === undefined ? {} : { command }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    };
    const result = await readLibraryViaSidecar(request, options);
    if (!result.ok) throw new Error(result.error ?? "pyrekordbox sidecar failed");
    return new SidecarReader(result, result.durationMs, request, options);
  }

  counts(): LibraryCounts {
    return this.payload.counts ?? { tracks: 0, playlists: 0, historySessions: 0, historyEntries: 0 };
  }

  dbVersion(): string | null {
    return this.payload.dbVersion ?? null;
  }

  trackRows(query: TrackQuery = {}): SqlRow[] {
    const rows = this.payload.tracks ?? [];
    const searched = query.search === undefined || query.search === ""
      ? rows
      : rows.filter((row) => matchesSearch(row, query.search as string));
    const offset = query.offset ?? 0;
    return searched.slice(offset, query.limit === undefined ? undefined : offset + query.limit);
  }

  trackRow(rekordboxId: string): SqlRow | undefined {
    return (this.payload.tracks ?? []).find((row) => String(row["ID"] ?? "") === rekordboxId);
  }

  trackCount(search?: string): number {
    if (search === undefined || search === "") return this.counts().tracks;
    return (this.payload.tracks ?? []).filter((row) => matchesSearch(row, search)).length;
  }

  playlistRows(): SqlRow[] {
    return this.payload.playlists ?? [];
  }

  songPlaylistRows(playlistId: string): PlaylistEntry[] {
    return (this.payload.songPlaylists ?? [])
      .filter((row) => String(row["PlaylistID"] ?? "") === playlistId)
      .map((row) => ({ rekordboxId: String(row["ContentID"] ?? ""), trackNo: Number(row["TrackNo"] ?? 0) }));
  }

  historyRows(): SqlRow[] {
    return this.payload.history ?? [];
  }

  songHistoryRows(historyId: string): PlaylistEntry[] {
    return (this.payload.songHistory ?? [])
      .filter((row) => String(row["HistoryID"] ?? "") === historyId)
      .map((row) => ({ rekordboxId: String(row["ContentID"] ?? ""), trackNo: Number(row["TrackNo"] ?? 0) }));
  }

  /** Attempt a write through the sidecar's handle; SQLite must reject it. */
  async probeWrite(): Promise<{ rejected: boolean; error: string | null }> {
    const result = await readLibraryViaSidecar({ ...this.request, probeWrite: true }, this.options);
    return result.writeProbe ?? { rejected: false, error: result.error ?? "sidecar reported no probe outcome" };
  }

  close(): void {
    // Nothing held open: the interpreter exited with the dump.
  }
}

function matchesSearch(row: SqlRow, needle: string): boolean {
  const lower = needle.toLowerCase();
  return ["Title", "artistName", "FolderPath"].some((column) =>
    String(row[column] ?? "").toLowerCase().includes(lower),
  );
}

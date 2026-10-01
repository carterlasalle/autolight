// ANLZ path resolution from master.db rows (T-RBL-02, closes F-RBL-08; §5).
//
// `djmdContent.AnalysisDataPath` is the ANLZ `.DAT` path relative to
// Rekordbox's share directory (leading separator included). `.EXT` and `.2EX`
// are siblings with the same base name, so they are derived by extension swap
// on the row's own DAT name rather than by string math on a constant file name.
// Verified against the owner's library (share/PIONEER/USBANLZ/.../ANLZ0000.DAT
// with .EXT and .2EX present) and against pyrekordbox's get_anlz_dir.
//
// Missing files are statuses, never exceptions: a removed audio file or a
// half written ANLZ set is reported per track and the row still loads.
import { statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export interface FileFacts {
  path: string;
  exists: boolean;
  sizeBytes: number | null;
  mtimeMs: number | null;
}

export type TrackFileStatus = "audio-ok" | "audio-missing" | "anlz-ok" | "anlz-missing" | "anlz-partial";

export interface AnlzResolution {
  /** ANLZ directory (share-relative path resolved to absolute), when the row has one. */
  anlzDir: string | null;
  dat: FileFacts | null;
  ext: FileFacts | null;
  ex2: FileFacts | null;
  audio: FileFacts | null;
  statuses: TrackFileStatus[];
}

/** File facts source. `undefined` means the path does not exist. */
export type StatFile = (path: string) => { sizeBytes: number; mtimeMs: number } | undefined;

export interface AnlzResolveOptions {
  sharePath: string;
  /** Test seam: replaces fs.statSync. */
  statFile?: StatFile;
  /** Test seam: audio path existence check (some rows point at unmounted volumes). */
  audioPath?: string | null;
}

const ANLZ_SUFFIXES = [".EXT", ".2EX"] as const;

function defaultStat(path: string): { sizeBytes: number; mtimeMs: number } | undefined {
  try {
    const stats = statSync(path);
    return { sizeBytes: stats.size, mtimeMs: stats.mtimeMs };
  } catch {
    return undefined;
  }
}

function facts(path: string, statFile: StatFile): FileFacts {
  const found = statFile(path);
  return {
    path,
    exists: found !== undefined,
    sizeBytes: found?.sizeBytes ?? null,
    mtimeMs: found?.mtimeMs ?? null,
  };
}

/**
 * resolveAnlzSet maps one library row onto its file facts.
 *
 * Resolution rule, verified against the owner's library: the stored path
 * carries a leading separator but is relative to Rekordbox's share directory
 * (`share/PIONEER/USBANLZ/.../ANLZ0000.DAT`). A stored path that exists as a
 * full absolute path (older exports) wins when the share-relative form is not
 * there.
 */
export function resolveAnlzSet(
  row: { analysisDataPath?: string | null },
  options: AnlzResolveOptions,
): AnlzResolution {
  const statFile = options.statFile ?? defaultStat;
  const stored = row.analysisDataPath ?? "";
  const relative = stored.replace(/^[\\/]+/, "");
  const audioPath = options.audioPath ?? null;
  const audio = audioPath === null || audioPath === "" ? null : facts(audioPath, statFile);
  const statuses: TrackFileStatus[] = [];
  if (audio !== null) statuses.push(audio.exists ? "audio-ok" : "audio-missing");

  if (relative === "") {
    statuses.push("anlz-missing");
    return { anlzDir: null, dat: null, ext: null, ex2: null, audio, statuses };
  }
  const joined = join(options.sharePath, relative);
  const datPath = isAbsolute(stored) && statFile(joined) === undefined && statFile(stored) !== undefined ? stored : joined;
  const extPath = swapSuffix(datPath, ANLZ_SUFFIXES[0]);
  const ex2Path = swapSuffix(datPath, ANLZ_SUFFIXES[1]);
  const dat = facts(datPath, statFile);
  const ext = facts(extPath, statFile);
  const ex2 = facts(ex2Path, statFile);
  if (!dat.exists) statuses.push("anlz-missing");
  else if (!ext.exists || !ex2.exists) statuses.push("anlz-partial");
  else statuses.push("anlz-ok");
  return { anlzDir: dirname(datPath), dat, ext, ex2, audio, statuses };
}

function swapSuffix(path: string, suffix: string): string {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  if (dot <= slash) return `${path}${suffix}`;
  return `${path.slice(0, dot)}${suffix}`;
}

// Rekordbox library reader over the read-only SQLCipher handle (T-RBL-01 and
// T-RBL-02; spec 4.1, 5, 12, 9.5).
//
// One normalization for every reader mode: both the SQLite reader here and the
// pyrekordbox sidecar return `c.*`-shaped raw rows from the same joins, and
// `mapTrackRow` turns them into `LibraryTrack`. Reading only; there is no write
// path, and the handle underneath is opened read-only (T-SEC-04 reads the
// query_only lock back after setting it, so a silently writable handle fails
// the open; a checkpoint is a write, so nothing here checkpoints either).
import { resolveAnlzSet, type AnlzResolution, type StatFile } from "./anlz.js";
import { attemptWrite, openReadOnly, type DbDriverName, type ReadOnlyDb, type SqlParams, type SqlRow } from "./driver.js";

export const DEFAULT_PAGE_SIZE = 50;

export interface LibraryTrack {
  rekordboxId: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  key: string | null;
  bpm: number | null;
  durationSeconds: number | null;
  rating: number | null;
  color: string | null;
  comments: string | null;
  dateAdded: string | null;
  filePath: string | null;
  fileSize: number | null;
  sampleRate: number | null;
  bitRate: number | null;
  analysisDataPath: string | null;
  anlz: AnlzResolution;
  raw: SqlRow;
}

export type PlaylistKind = "playlist" | "folder" | "smart";

export interface LibraryPlaylist {
  id: string;
  name: string;
  seq: number | null;
  parentId: string | null;
  kind: PlaylistKind;
  dateCreated: string | null;
  raw: SqlRow;
}

export interface LibraryHistorySession {
  id: string;
  name: string;
  seq: number | null;
  dateCreated: string | null;
  trackCount: number;
  raw: SqlRow;
}

export interface LibraryCounts {
  tracks: number;
  playlists: number;
  historySessions: number;
  historyEntries: number;
}

export interface TrackQuery {
  search?: string;
  offset?: number;
  limit?: number;
}

export interface PlaylistEntry {
  rekordboxId: string;
  trackNo: number;
}

/**
 * Raw-row source behind the service. Both DS-15 readers implement it, so the
 * normalized rows are identical whichever one is active.
 */
export interface LibrarySource {
  /** Which driver answered, for diagnostics. */
  readonly driver: string;
  counts(): LibraryCounts;
  dbVersion(): string | null;
  trackRows(query: TrackQuery): SqlRow[];
  trackCount(search?: string): number;
  trackRow(rekordboxId: string): SqlRow | undefined;
  playlistRows(): SqlRow[];
  songPlaylistRows(playlistId: string): PlaylistEntry[];
  historyRows(): SqlRow[];
  songHistoryRows(historyId: string): PlaylistEntry[];
  close(): void;
}

export interface ReaderConfig {
  dbPath: string;
  sharePath: string;
  key?: string;
  statFile?: StatFile;
}

const CONTENT = "djmdContent";
const PLAYLIST = "djmdPlaylist";
const HISTORY = "djmdHistory";
const SONG_HISTORY = "djmdSongHistory";
const SONG_PLAYLIST = "djmdSongPlaylist";
const PROPERTY = "djmdProperty";

// Playlist Attribute: 0 playlist, 1 folder, 4 smart playlist (pyrekordbox
// PlaylistType and the rekordbox-connect schema notes).
const PLAYLIST_ATTRIBUTE_KINDS: Record<string, PlaylistKind> = { "0": "playlist", "1": "folder", "4": "smart" };

/** Joined track SELECT shared by the SQLite reader and the sidecar script. */
export const TRACK_SELECT = `SELECT c.*,
         ar.Name AS artistName,
         al.Name AS albumName,
         ge.Name AS genreName,
         k.ScaleName AS keyName,
         co.Commnt AS colorName
  FROM ${CONTENT} AS c
  LEFT JOIN djmdArtist AS ar ON c.ArtistID = ar.ID
  LEFT JOIN djmdAlbum AS al ON c.AlbumID = al.ID
  LEFT JOIN djmdGenre AS ge ON c.GenreID = ge.ID
  LEFT JOIN djmdKey AS k ON c.KeyID = k.ID
  LEFT JOIN djmdColor AS co ON c.ColorID = co.ID`;

const SEARCH_WHERE = " WHERE c.Title LIKE :search OR ar.Name LIKE :search OR c.FolderPath LIKE :search";

export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** Normalize one joined `djmdContent` row; the single mapping for all readers. */
export function mapTrackRow(row: SqlRow, opts: { sharePath: string; statFile?: StatFile }): LibraryTrack {
  const analysisDataPath = stringOrNull(row["AnalysisDataPath"] ?? null);
  const filePath = stringOrNull(row["FolderPath"] ?? null);
  const anlzOptions = opts.statFile === undefined
    ? { sharePath: opts.sharePath, audioPath: filePath }
    : { sharePath: opts.sharePath, audioPath: filePath, statFile: opts.statFile };
  return {
    rekordboxId: text(row["ID"], ""),
    title: stringOrNull(row["Title"] ?? null),
    artist: stringOrNull(row["artistName"] ?? null),
    album: stringOrNull(row["albumName"] ?? null),
    genre: stringOrNull(row["genreName"] ?? null),
    key: stringOrNull(row["keyName"] ?? null),
    bpm: numberOrNull(row["BPM"] ?? null),
    durationSeconds: numberOrNull(row["Length"] ?? null),
    rating: numberOrNull(row["Rating"] ?? null),
    color: stringOrNull(row["colorName"] ?? null),
    comments: stringOrNull(row["Commnt"] ?? null),
    dateAdded: stringOrNull(row["DateCreated"] ?? null),
    filePath,
    fileSize: numberOrNull(row["FileSize"] ?? null),
    sampleRate: numberOrNull(row["SampleRate"] ?? null),
    bitRate: numberOrNull(row["BitRate"] ?? null),
    analysisDataPath,
    anlz: resolveAnlzSet({ analysisDataPath }, anlzOptions),
    raw: row,
  };
}

export function mapPlaylistRow(row: SqlRow): LibraryPlaylist {
  return {
    id: text(row["ID"], ""),
    name: text(row["Name"], ""),
    seq: numberOrNull(row["Seq"] ?? null),
    parentId: stringOrNull(row["ParentID"] ?? null),
    kind: PLAYLIST_ATTRIBUTE_KINDS[String(numberOrNull(row["Attribute"] ?? null) ?? 0)] ?? "playlist",
    dateCreated: stringOrNull(row["DateCreated"] ?? null),
    raw: row,
  };
}

export function mapHistoryRow(row: SqlRow, trackCount: number): LibraryHistorySession {
  return {
    id: text(row["ID"], ""),
    name: text(row["Name"], ""),
    seq: numberOrNull(row["Seq"] ?? null),
    dateCreated: stringOrNull(row["DateCreated"] ?? null),
    trackCount,
    raw: row,
  };
}

export class RekordboxReader implements LibrarySource {
  private readonly db: ReadOnlyDb;
  private readonly config: ReaderConfig;

  private constructor(db: ReadOnlyDb, config: ReaderConfig) {
    this.db = db;
    this.config = config;
  }

  static async open(config: ReaderConfig): Promise<RekordboxReader> {
    const db = await openReadOnly(config.dbPath, config.key);
    return new RekordboxReader(db, config);
  }

  get driver(): DbDriverName {
    return this.db.driver;
  }

  get dbPath(): string {
    return this.config.dbPath;
  }

  get sharePath(): string {
    return this.config.sharePath;
  }

  counts(): LibraryCounts {
    const count = (table: string): number => {
      const row = this.db.get(`SELECT count(*) AS n FROM ${table}`);
      return numberOrNull(row?.["n"] ?? null) ?? 0;
    };
    return {
      tracks: count(CONTENT),
      playlists: count(PLAYLIST),
      historySessions: count(HISTORY),
      historyEntries: count(SONG_HISTORY),
    };
  }

  /** Database format version Rekordbox wrote (djmdProperty.DBVersion). */
  dbVersion(): string | null {
    return stringOrNull(this.db.get(`SELECT DBVersion AS v FROM ${PROPERTY} LIMIT 1`)?.["v"] ?? null);
  }

  trackRows(query: TrackQuery = {}): SqlRow[] {
    const params: SqlParams = {
      limit: query.limit ?? DEFAULT_PAGE_SIZE,
      offset: query.offset ?? 0,
    };
    let sql = TRACK_SELECT;
    if (query.search !== undefined && query.search !== "") {
      params["search"] = `%${query.search}%`;
      sql += SEARCH_WHERE;
    }
    sql += " ORDER BY c.ID LIMIT :limit OFFSET :offset";
    return this.db.all(sql, params);
  }

  trackCount(search?: string): number {
    const params: SqlParams = {};
    let sql = `SELECT count(*) AS n FROM ${CONTENT} AS c LEFT JOIN djmdArtist AS ar ON c.ArtistID = ar.ID`;
    if (search !== undefined && search !== "") {
      params["search"] = `%${search}%`;
      sql += SEARCH_WHERE;
    }
    return numberOrNull(this.db.get(sql, params)?.["n"] ?? null) ?? 0;
  }

  trackRow(rekordboxId: string): SqlRow | undefined {
    return this.db.get(`${TRACK_SELECT} WHERE c.ID = :id`, { id: rekordboxId });
  }

  playlistRows(): SqlRow[] {
    return this.db.all(`SELECT * FROM ${PLAYLIST} ORDER BY Seq`);
  }

  songPlaylistRows(playlistId: string): PlaylistEntry[] {
    return this.db
      .all(`SELECT ContentID AS id, TrackNo AS trackNo FROM ${SONG_PLAYLIST} WHERE PlaylistID = :id ORDER BY TrackNo`, {
        id: playlistId,
      })
      .map((row) => ({ rekordboxId: text(row["id"], ""), trackNo: numberOrNull(row["trackNo"] ?? null) ?? 0 }));
  }

  historyRows(): SqlRow[] {
    return this.db.all(`SELECT * FROM ${HISTORY} ORDER BY Seq`);
  }

  songHistoryRows(historyId: string): PlaylistEntry[] {
    return this.db
      .all(`SELECT ContentID AS id, TrackNo AS trackNo FROM ${SONG_HISTORY} WHERE HistoryID = :id ORDER BY TrackNo`, {
        id: historyId,
      })
      .map((row) => ({ rekordboxId: text(row["id"], ""), trackNo: numberOrNull(row["trackNo"] ?? null) ?? 0 }));
  }

  historyTrackCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const row of this.db.all(`SELECT HistoryID AS id, count(*) AS n FROM ${SONG_HISTORY} GROUP BY HistoryID`)) {
      counts[text(row["id"], "")] = numberOrNull(row["n"] ?? null) ?? 0;
    }
    return counts;
  }

  /** Read-only self check: a write through this reader's handle must throw. */
  probeWrite(): { rejected: boolean; error: string | null } {
    return attemptWrite(this.db);
  }

  close(): void {
    this.db.close();
  }
}

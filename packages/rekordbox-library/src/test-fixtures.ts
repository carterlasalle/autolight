// Fixture library builder for the reader, sidecar and watcher tests.
//
// Creates a small database with the real Rekordbox table and column names plus
// the ANLZ and audio files its rows point at, so every reader mode and the
// watcher run against the same shape they meet on a real machine. The plan
// places the shared generator at tools/fixtures/make-rekordbox-db; this module
// is the in-package seam the tests use, with the same column set.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TRACK_SELECT, type LibraryCounts } from "./db.js";
import type { SqlRow } from "./driver.js";
import type { SidecarPayload } from "./sidecar.js";

export interface FixtureOptions {
  dbPath: string;
  sharePath: string;
  /** Directory the audio files are written to. */
  audioDir: string;
}

export interface FixtureSummary {
  trackIds: string[];
  playlistIds: string[];
  historyId: string;
  counts: LibraryCounts;
  /** Track id to ANLZ file names written under the share path. */
  anlzFiles: Record<string, string[]>;
  audioFiles: Record<string, string>;
}

const SCHEMA = `
CREATE TABLE djmdContent (
  ID TEXT PRIMARY KEY, FolderPath TEXT, Title TEXT, ArtistID TEXT, AlbumID TEXT, GenreID TEXT,
  KeyID TEXT, ColorID TEXT, BPM INTEGER, Length INTEGER, Rating INTEGER, Commnt TEXT,
  DateCreated TEXT, FileSize INTEGER, SampleRate INTEGER, BitRate INTEGER, AnalysisDataPath TEXT
);
CREATE TABLE djmdArtist (ID TEXT PRIMARY KEY, Name TEXT);
CREATE TABLE djmdAlbum (ID TEXT PRIMARY KEY, Name TEXT);
CREATE TABLE djmdGenre (ID TEXT PRIMARY KEY, Name TEXT);
CREATE TABLE djmdKey (ID TEXT PRIMARY KEY, ScaleName TEXT);
CREATE TABLE djmdColor (ID TEXT PRIMARY KEY, Commnt TEXT);
CREATE TABLE djmdPlaylist (ID TEXT PRIMARY KEY, Seq INTEGER, Name TEXT, Attribute INTEGER, ParentID TEXT, DateCreated TEXT);
CREATE TABLE djmdSongPlaylist (ID TEXT PRIMARY KEY, PlaylistID TEXT, ContentID TEXT, TrackNo INTEGER);
CREATE TABLE djmdHistory (ID TEXT PRIMARY KEY, Seq INTEGER, Name TEXT, Attribute INTEGER, DateCreated TEXT);
CREATE TABLE djmdSongHistory (ID TEXT PRIMARY KEY, HistoryID TEXT, ContentID TEXT, TrackNo INTEGER);
CREATE TABLE djmdProperty (DBID TEXT PRIMARY KEY, DBVersion TEXT);
`;

const TRACKS = [
  { ID: "101", Title: "Aurora", ArtistID: "a1", AlbumID: "b1", GenreID: "g1", KeyID: "k1", ColorID: "c1", BPM: 128, Length: 300, Rating: 204, Commnt: "peak time", DateCreated: "2026-01-05 10:00:00.000 +00:00", FileSize: 9000000, SampleRate: 44100, BitRate: 320, anlz: "full" },
  { ID: "102", Title: "Basalt", ArtistID: "a1", AlbumID: "b1", GenreID: "g2", KeyID: "k2", ColorID: "c2", BPM: 124, Length: 280, Rating: 102, Commnt: "", DateCreated: "2026-01-06 10:00:00.000 +00:00", FileSize: 8000000, SampleRate: 48000, BitRate: 256, anlz: "partial" },
  { ID: "103", Title: "Cinder", ArtistID: "a2", AlbumID: "b2", GenreID: "g1", KeyID: "k1", ColorID: null, BPM: 132, Length: 260, Rating: 0, Commnt: "tool", DateCreated: "2026-01-07 10:00:00.000 +00:00", FileSize: 7000000, SampleRate: 44100, BitRate: 320, anlz: "missing" },
  { ID: "104", Title: "Delta", ArtistID: "a2", AlbumID: null, GenreID: null, KeyID: null, ColorID: null, BPM: null, Length: null, Rating: null, Commnt: null, DateCreated: "", FileSize: null, SampleRate: null, BitRate: null, anlz: false },
] as const;

const ANLZ_SUFFIXES = { full: [".DAT", ".EXT", ".2EX"], partial: [".DAT"], missing: [".DAT"] } as const;

/** Write the fixture database, its ANLZ siblings and its audio files. */
export function writeFixtureDb(options: FixtureOptions): FixtureSummary {
  mkdirSync(dirname(options.dbPath), { recursive: true });
  mkdirSync(options.sharePath, { recursive: true });
  mkdirSync(options.audioDir, { recursive: true });
  const db = new DatabaseSync(options.dbPath);
  const anlzFiles: Record<string, string[]> = {};
  const audioFiles: Record<string, string> = {};
  try {
    db.exec(SCHEMA);
    const write = (sql: string, params: Record<string, string | number | null>): void => {
      db.prepare(sql).run(params);
    };
    write("INSERT INTO djmdProperty VALUES ('1', '6000')", {});
    write("INSERT INTO djmdArtist VALUES ('a1', 'Nova')", {});
    write("INSERT INTO djmdArtist VALUES ('a2', 'Kestrel')", {});
    write("INSERT INTO djmdAlbum VALUES ('b1', 'First Light')", {});
    write("INSERT INTO djmdAlbum VALUES ('b2', 'Second Wind')", {});
    write("INSERT INTO djmdGenre VALUES ('g1', 'Techno')", {});
    write("INSERT INTO djmdGenre VALUES ('g2', 'House')", {});
    write("INSERT INTO djmdKey VALUES ('k1', '8A')", {});
    write("INSERT INTO djmdKey VALUES ('k2', '9B')", {});
    write("INSERT INTO djmdColor VALUES ('c1', 'Red')", {});
    write("INSERT INTO djmdColor VALUES ('c2', 'Blue')", {});

    for (const track of TRACKS) {
      const audioPath = join(options.audioDir, `${track.ID}.mp3`);
      writeFileSync(audioPath, `audio-${track.ID}`);
      audioFiles[track.ID] = audioPath;
      let analysisDataPath: string | null = null;
      if (track.anlz !== false) {
        const relative = `/PIONEER/USBANLZ/${track.ID}/${track.ID}/ANLZ0000`;
        const suffixes = ANLZ_SUFFIXES[track.anlz];
        analysisDataPath = `${relative}.DAT`;
        if (track.anlz !== "missing") {
          mkdirSync(join(options.sharePath, `PIONEER/USBANLZ/${track.ID}/${track.ID}`), { recursive: true });
          for (const suffix of suffixes) {
            writeFileSync(join(options.sharePath, `${relative.replace(/^\//, "")}${suffix}`), `anlz-${track.ID}${suffix}`);
          }
          anlzFiles[track.ID] = suffixes.map((suffix) => `${relative}.${suffix.slice(1)}`);
        }
      }
      write(
        `INSERT INTO djmdContent (ID, FolderPath, Title, ArtistID, AlbumID, GenreID, KeyID, ColorID, BPM, Length, Rating, Commnt, DateCreated, FileSize, SampleRate, BitRate, AnalysisDataPath)
         VALUES (:ID, :FolderPath, :Title, :ArtistID, :AlbumID, :GenreID, :KeyID, :ColorID, :BPM, :Length, :Rating, :Commnt, :DateCreated, :FileSize, :SampleRate, :BitRate, :AnalysisDataPath)`,
        {
          ID: track.ID,
          FolderPath: audioPath,
          Title: track.Title,
          ArtistID: track.ArtistID,
          AlbumID: track.AlbumID,
          GenreID: track.GenreID,
          KeyID: track.KeyID,
          ColorID: track.ColorID,
          BPM: track.BPM,
          Length: track.Length,
          Rating: track.Rating,
          Commnt: track.Commnt,
          DateCreated: track.DateCreated,
          FileSize: track.FileSize,
          SampleRate: track.SampleRate,
          BitRate: track.BitRate,
          AnalysisDataPath: analysisDataPath,
        },
      );
    }
    // Missing audio: one row points at a file that is not there.
    write("UPDATE djmdContent SET FolderPath = :path WHERE ID = '104'", { path: join(options.audioDir, "gone.mp3") });

    write("INSERT INTO djmdPlaylist VALUES ('p1', 1, 'Pregame', 0, NULL, '2026-01-05 10:00:00.000 +00:00')", {});
    write("INSERT INTO djmdPlaylist VALUES ('f1', 2, 'Sets', 1, NULL, NULL)", {});
    write("INSERT INTO djmdPlaylist VALUES ('p2', 3, 'Peak', 0, 'f1', NULL)", {});
    const membership: [string, string, number][] = [
      ["s1", "p1", 101],
      ["s2", "p1", 102],
      ["s3", "p2", 103],
      ["s4", "p2", 101],
    ];
    for (const [id, playlistId, contentId] of membership) {
      write("INSERT INTO djmdSongPlaylist VALUES (:ID, :PlaylistID, :ContentID, :TrackNo)", {
        ID: id,
        PlaylistID: playlistId,
        ContentID: String(contentId),
        TrackNo: 1,
      });
    }
    write("INSERT INTO djmdHistory VALUES ('h1', 1, '2026-09-29', 0, '2026-09-29 22:00:00.000 +00:00')", {});
    for (const [index, contentId] of ["101", "103", "101"].entries()) {
      write("INSERT INTO djmdSongHistory VALUES (:ID, 'h1', :ContentID, :TrackNo)", {
        ID: `sh${index}`,
        ContentID: contentId,
        TrackNo: index + 1,
      });
    }
  } finally {
    db.close();
  }
  return {
    trackIds: TRACKS.map((track) => track.ID),
    playlistIds: ["p1", "f1", "p2"],
    historyId: "h1",
    counts: { tracks: TRACKS.length, playlists: 3, historySessions: 1, historyEntries: 3 },
    anlzFiles,
    audioFiles,
  };
}

/**
 * Read the fixture the way the pyrekordbox sidecar reports it, so tests can
 * drive the service and the sidecar client without an interpreter.
 */
export function readFixturePayload(dbPath: string, limit = 5000): SidecarPayload {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = (sql: string, params: Record<string, string | number> = {}): SqlRow[] =>
      db.prepare(sql).all(params) as SqlRow[];
    return {
      ok: true,
      counts: {
        tracks: rows("SELECT count(*) AS n FROM djmdContent")[0]?.["n"] as number,
        playlists: rows("SELECT count(*) AS n FROM djmdPlaylist")[0]?.["n"] as number,
        historySessions: rows("SELECT count(*) AS n FROM djmdHistory")[0]?.["n"] as number,
        historyEntries: rows("SELECT count(*) AS n FROM djmdSongHistory")[0]?.["n"] as number,
      },
      dbVersion: (rows("SELECT DBVersion AS v FROM djmdProperty LIMIT 1")[0]?.["v"] as string | null) ?? null,
      tracks: rows(`${TRACK_SELECT} ORDER BY c.ID LIMIT :limit`, { limit }),
      playlists: rows("SELECT * FROM djmdPlaylist ORDER BY Seq"),
      songPlaylists: rows("SELECT PlaylistID, ContentID, TrackNo FROM djmdSongPlaylist ORDER BY PlaylistID, TrackNo").map(
        (row) => ({
          ...row,
          PlaylistID: String(row["PlaylistID"] ?? ""),
          ContentID: String(row["ContentID"] ?? ""),
          TrackNo: Number(row["TrackNo"] ?? 0),
        }),
      ),
      history: rows("SELECT * FROM djmdHistory ORDER BY Seq"),
      songHistory: rows("SELECT HistoryID, ContentID, TrackNo FROM djmdSongHistory ORDER BY HistoryID, TrackNo").map(
        (row) => ({
          ...row,
          HistoryID: String(row["HistoryID"] ?? ""),
          ContentID: String(row["ContentID"] ?? ""),
          TrackNo: Number(row["TrackNo"] ?? 0),
        }),
      ),
    };
  } finally {
    db.close();
  }
}

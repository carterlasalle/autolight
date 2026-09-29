// READ ONLY: never writes Rekordbox's database (§4.1).
export const READ_ONLY = true;

export interface LibraryTrackRow {
  rekordboxId: string;
  title?: string;
  artist?: string;
  filePath?: string;
  analysisDataPath?: string;
}

// master.db row → track identity fields (§12 resolution starts at native ID + path).
export function rowToIdentity(row: LibraryTrackRow): { rekordboxId: string; canonicalPath?: string; title?: string; artist?: string } {
  const out: { rekordboxId: string; canonicalPath?: string; title?: string; artist?: string } = { rekordboxId: row.rekordboxId };
  if (row.filePath) out.canonicalPath = row.filePath;
  if (row.title) out.title = row.title;
  if (row.artist) out.artist = row.artist;
  return out;
}

// AnalysisDataPath → ANLZ sibling set (§5). Pure path math, no I/O here.
export function anlzPaths(analysisDataPath: string): { dat: string; ext: string; ex2: string } {
  const base = analysisDataPath.replace(/ANLZ0000\.(DAT|EXT|2EX)$/i, "");
  return { dat: `${base}ANLZ0000.DAT`, ext: `${base}ANLZ0000.EXT`, ex2: `${base}ANLZ0000.2EX` };
}

// PQTZ beat → canonical grid entry (§5.1). Throws on invalid bar position.
export function toNativeBeat(raw: { index: number; beatInBar: number; sourceTimeMs: number; bpm: number }): { index: number; beatInBar: 1 | 2 | 3 | 4; sourceTimeMs: number; bpm: number } {
  if (![1, 2, 3, 4].includes(raw.beatInBar)) throw new RangeError(`beatInBar=${raw.beatInBar}, expected 1-4`);
  return raw as { index: number; beatInBar: 1 | 2 | 3 | 4; sourceTimeMs: number; bpm: number };
}

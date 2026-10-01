// @autolight/rekordbox-library: the Rekordbox library plane (spec 4.1, §5,
// §12, §73, §74, §141).
//
// READ ONLY: nothing in this package writes Rekordbox data. The database is
// opened read-only, no handle exposes a write method, and the SQL here is
// SELECT-only (T-SEC-04 enforces the same rule from the outside).
export const READ_ONLY = true;

export * from "./anlz.js";
export * from "./beat.js";
export * from "./db.js";
export * from "./driver.js";
export * from "./options.js";
export * from "./pssi.js";
export * from "./service.js";
export * from "./identity.js";
export * from "./sidecar.js";
export * from "./watch.js";

// master.db row → track identity fields (§12 resolution starts at native ID +
// path). The composite provider carries the path as `canonicalPath`, the raw
// database row as `filePath`; both normalize here.
export interface LibraryTrackRow {
  rekordboxId: string;
  title?: string;
  artist?: string;
  filePath?: string;
  canonicalPath?: string;
  analysisDataPath?: string;
}

export function rowToIdentity(row: LibraryTrackRow): { rekordboxId: string; canonicalPath?: string; title?: string; artist?: string } {
  const path = row.canonicalPath ?? row.filePath;
  const out: { rekordboxId: string; canonicalPath?: string; title?: string; artist?: string } = { rekordboxId: row.rekordboxId };
  if (path !== undefined && path !== "") out.canonicalPath = path;
  if (row.title !== undefined && row.title !== "") out.title = row.title;
  if (row.artist !== undefined && row.artist !== "") out.artist = row.artist;
  return out;
}

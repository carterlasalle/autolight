// TrackId keying for Library UI state (T-ID-03, spec 12, F-ID-03). Pure and
// dependency-free on purpose: the renderer must not import
// @autolight/storage (node sqlite), so this mirrors its validation rule
// without the dependency. Rows, selection and Inspector matching are keyed
// by TrackId, never by title: two tracks can share a title and a retag
// changes the title without changing the track.

export function normalizeTrackId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) throw new Error("track-key: empty TrackId (never fall back to title)");
  return trimmed;
}

export interface LibraryRowLike {
  trackId: string;
  title: string;
  artist?: string | undefined;
}

// React key for a library row: TrackId only, so a rename keeps the row and
// its state instead of unmounting it.
export function libraryRowKey(row: LibraryRowLike): string {
  return normalizeTrackId(row.trackId);
}

// Selection/Inspector match: the selected TrackId matches exactly one track,
// even when several rows share its title.
export function isSelectedTrack(row: LibraryRowLike, selectedTrackId: string | null): boolean {
  if (!selectedTrackId) return false;
  return normalizeTrackId(row.trackId) === normalizeTrackId(selectedTrackId);
}

// Labels for same-title rows (T-ID-03 DoD): keys stay the TrackIds, labels
// disambiguate with artist, then an id suffix. Unique titles render unchanged.
export function libraryRowLabels(rows: readonly LibraryRowLike[]): Map<string, string> {
  const byTitle = new Map<string, LibraryRowLike[]>();
  for (const row of rows) {
    const list = byTitle.get(row.title);
    if (list) list.push(row);
    else byTitle.set(row.title, [row]);
  }
  const labels = new Map<string, string>();
  for (const list of byTitle.values()) {
    if (list.length === 1) {
      const only = list[0];
      if (only) labels.set(libraryRowKey(only), only.title);
      continue;
    }
    for (const row of list) {
      const base = row.artist ? `${row.title} - ${row.artist}` : row.title;
      labels.set(libraryRowKey(row), `${base} (${libraryRowKey(row).slice(0, 8)})`);
    }
  }
  return labels;
}

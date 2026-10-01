// TrackId keying (T-ID-03, spec 12, F-ID-03). Library rows, Inspector
// selection, corrections, the preanalysis queue and the plan cache are keyed
// by TrackId, never by title: titles collide and change on retag, TrackIds
// survive rename, move and retag (T-ID-01). This module is the single place
// that validates a TrackId and keeps per-track UI state across renames. The
// plan/artifact rows themselves are already keyed by track_id (cache.ts);
// what was missing was the UI-state half and one validation point.

export function normalizeTrackId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) throw new Error("track-key: empty TrackId (never fall back to title)");
  return trimmed;
}

// Per-track UI state (selection, inspector scroll, correction drafts) keyed
// by TrackId. A rename changes title and path, never the key, so state
// survives it by construction.
export class TrackStateMap<V> {
  private readonly entries = new Map<string, V>();

  get(trackId: string): V | undefined {
    return this.entries.get(normalizeTrackId(trackId));
  }

  set(trackId: string, value: V): void {
    this.entries.set(normalizeTrackId(trackId), value);
  }

  getOrCreate(trackId: string, create: () => V): V {
    const key = normalizeTrackId(trackId);
    const existing = this.entries.get(key);
    if (existing !== undefined) return existing;
    const value = create();
    this.entries.set(key, value);
    return value;
  }

  has(trackId: string): boolean {
    return this.entries.has(normalizeTrackId(trackId));
  }

  delete(trackId: string): void {
    this.entries.delete(normalizeTrackId(trackId));
  }

  // Drop state for tracks no longer in the library; never called on rename.
  retain(trackIds: Iterable<string>): void {
    const keep = new Set<string>();
    for (const id of trackIds) keep.add(normalizeTrackId(id));
    for (const key of this.entries.keys()) {
      if (!keep.has(key)) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface TitledRow {
  trackId: string;
  title: string;
  artist?: string | undefined;
}

// Display labels for rows that may share a title (T-ID-03 DoD): keys stay
// the TrackIds, labels disambiguate with artist, then an id suffix.
export function uniqueTrackLabels(rows: readonly TitledRow[]): Map<string, string> {
  const byTitle = new Map<string, TitledRow[]>();
  for (const row of rows) {
    const list = byTitle.get(row.title);
    if (list) list.push(row);
    else byTitle.set(row.title, [row]);
  }
  const labels = new Map<string, string>();
  for (const list of byTitle.values()) {
    if (list.length === 1) {
      const only = list[0];
      if (only) labels.set(normalizeTrackId(only.trackId), only.title);
      continue;
    }
    for (const row of list) {
      const base = row.artist ? `${row.title} - ${row.artist}` : row.title;
      labels.set(normalizeTrackId(row.trackId), `${base} (${normalizeTrackId(row.trackId).slice(0, 8)})`);
    }
  }
  return labels;
}

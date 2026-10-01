// Alias graph for durable track identity (spec 12, T-ID-01, P-12).
//
// Every native ID, path and hash ever seen for a TrackId is a row in
// `track_aliases` (packages/storage). A rename, move or retag attaches the
// new path to the existing TrackId by fileHash or pcm-hash, so cached
// artifacts and edits survive. The graph persists across restarts because it
// lives in the app database, not in memory.
//
// In-memory side: AliasGraph records aliases and resolves them. Persistence
// side: TrackAliasStore is the seam the app wires to SQL (`track_aliases`);
// tests use the memory implementation.

export type AliasSource = "rekordbox-id" | "serato-path" | "canonical-path" | "file-hash" | "pcm-hash";

export interface AliasRecord {
  trackId: string;
  aliasId: string;
  source: AliasSource;
  createdAt: string;
}

/** Minimal SQL surface the graph needs; implemented by the app over Store. */
export interface TrackAliasStore {
  insert(record: AliasRecord): void;
  aliasesOf(trackId: string): AliasRecord[];
  trackIdForAlias(aliasId: string): string | null;
  all(): AliasRecord[];
}

/** In-memory store for tests and for callers without a database open. */
export class MemoryAliasStore implements TrackAliasStore {
  private readonly byTrack = new Map<string, AliasRecord[]>();
  private readonly byAlias = new Map<string, string>();

  insert(record: AliasRecord): void {
    const existing = this.byTrack.get(record.trackId) ?? [];
    if (!existing.some((r) => r.aliasId === record.aliasId)) {
      existing.push(record);
      this.byTrack.set(record.trackId, existing);
      const owner = this.byAlias.get(record.aliasId);
      if (owner === undefined || owner === record.trackId) this.byAlias.set(record.aliasId, record.trackId);
    }
  }

  aliasesOf(trackId: string): AliasRecord[] {
    return [...(this.byTrack.get(trackId) ?? [])];
  }

  trackIdForAlias(aliasId: string): string | null {
    return this.byAlias.get(aliasId) ?? null;
  }

  all(): AliasRecord[] {
    return [...this.byTrack.values()].flat();
  }
}

export interface IdentityParts {
  rekordboxId?: string;
  seratoPath?: string;
  canonicalPath?: string;
  fileHash?: string;
  pcmFingerprint?: string;
  title?: string;
  artist?: string;
}

/** Normalize one path for alias comparison (case and separator folds). */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

/** Every alias string this identity answers to. */
export function aliasesFor(parts: IdentityParts): { aliasId: string; source: AliasSource }[] {
  const out: { aliasId: string; source: AliasSource }[] = [];
  if (parts.rekordboxId !== undefined && parts.rekordboxId !== "") out.push({ aliasId: `rb:${parts.rekordboxId}`, source: "rekordbox-id" });
  if (parts.seratoPath !== undefined && parts.seratoPath !== "") out.push({ aliasId: `path:${normalizePath(parts.seratoPath)}`, source: "serato-path" });
  if (parts.canonicalPath !== undefined && parts.canonicalPath !== "") out.push({ aliasId: `path:${normalizePath(parts.canonicalPath)}`, source: "canonical-path" });
  if (parts.fileHash !== undefined && parts.fileHash !== "") out.push({ aliasId: `hash:${parts.fileHash}`, source: "file-hash" });
  if (parts.pcmFingerprint !== undefined && parts.pcmFingerprint !== "") out.push({ aliasId: `pcm:${parts.pcmFingerprint}`, source: "pcm-hash" });
  return out;
}

/**
 * TrackId for identity parts against the graph. Exact pcm-hash or fileHash
 * wins over a native ID that moved: a new path whose hash matches an existing
 * TrackId attaches to it (rename/move migration). Title/artist alone never
 * resolve: they produce no alias, so they cannot claim a TrackId.
 */
export function resolveTrackId(store: TrackAliasStore, parts: IdentityParts, makeId: () => string): { trackId: string; attached: boolean } {
  const aliases = aliasesFor(parts);
  const strong = aliases.filter((a) => a.source === "pcm-hash" || a.source === "file-hash");
  for (const alias of [...strong, ...aliases]) {
    const owner = store.trackIdForAlias(alias.aliasId);
    if (owner !== null) {
      const now = new Date().toISOString();
      for (const missing of aliases) {
        if (store.trackIdForAlias(missing.aliasId) === null) {
          store.insert({ trackId: owner, aliasId: missing.aliasId, source: missing.source, createdAt: now });
        }
      }
      return { trackId: owner, attached: aliases.some((a) => store.trackIdForAlias(a.aliasId) === owner && a.aliasId !== alias.aliasId) || store.aliasesOf(owner).length > 1 };
    }
  }
  const trackId = makeId();
  const now = new Date().toISOString();
  for (const alias of aliases) store.insert({ trackId, aliasId: alias.aliasId, source: alias.source, createdAt: now });
  return { trackId, attached: false };
}

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
  /** All-or-nothing batch insert: validates alias ownership before mutating,
   * so a mid-loop failure can never leave a partial alias set behind. */
  insertMany(records: AliasRecord[]): void;
  aliasesOf(trackId: string): AliasRecord[];
  trackIdForAlias(aliasId: string): string | null;
  all(): AliasRecord[];
}

/** In-memory store for tests and for callers without a database open. */
export class MemoryAliasStore implements TrackAliasStore {
  private readonly byTrack = new Map<string, AliasRecord[]>();
  private readonly byAlias = new Map<string, string>();

  insert(record: AliasRecord): void {
    const owner = this.byAlias.get(record.aliasId);

    if (owner !== undefined && owner !== record.trackId) return;
    const existing = this.byTrack.get(record.trackId) ?? [];

    if (existing.some((r) => r.aliasId === record.aliasId)) return;
    existing.push(record);
    this.byTrack.set(record.trackId, existing);
    this.byAlias.set(record.aliasId, record.trackId);
  }

  /** All-or-nothing batch insert: validates ownership before mutating. */
  insertMany(records: AliasRecord[]): void {
    for (const record of records) {
      const owner = this.byAlias.get(record.aliasId);

      if (owner !== undefined && owner !== record.trackId) return;
    }

    for (const record of records) this.insert(record);
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

/** Normalize one path for alias comparison (separator/whitespace folds).
 * Case is preserved: `/Music/A.mp3` and `/Music/a.mp3` are different files
 * on case-sensitive filesystems. Callers that need cross-platform matching
 * add the lowercased form as a second alias (see aliasesFor). */
export function normalizePath(path: string): string {
  const slashed = path.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");

  return slashed.length > 1 ? slashed.replace(/\/$/, "") : slashed;
}

/** Every alias string this identity answers to. */
export function aliasesFor(parts: IdentityParts): { aliasId: string; source: AliasSource }[] {
  const out: { aliasId: string; source: AliasSource }[] = [];

  if (parts.rekordboxId !== undefined && parts.rekordboxId !== "") out.push({ aliasId: `rb:${parts.rekordboxId}`, source: "rekordbox-id" });
  const pushPath = (raw: string | undefined, source: AliasSource): void => {
    if (raw === undefined || raw === "") return;
    const folded = normalizePath(raw);
    out.push({ aliasId: `path:${folded}`, source });
    const lowered = folded.toLowerCase();

    if (lowered !== folded) out.push({ aliasId: `path:${lowered}`, source });
  };
  pushPath(parts.seratoPath, "serato-path");
  pushPath(parts.canonicalPath, "canonical-path");

  if (parts.pcmFingerprint !== undefined && parts.pcmFingerprint !== "") out.push({ aliasId: `pcm:${parts.pcmFingerprint}`, source: "pcm-hash" });

  if (parts.fileHash !== undefined && parts.fileHash !== "") out.push({ aliasId: `hash:${parts.fileHash}`, source: "file-hash" });

  return out;
}

/**
 * TrackId for identity parts against the graph. Exact pcm-hash or fileHash
 * wins over a native ID that moved: a new path whose hash matches an existing
 * TrackId attaches to it (rename/move migration). Title/artist alone never
 * resolve: they produce no alias, so they cannot claim a TrackId.
 * When strong aliases disagree (pcm-hash owned by A, file-hash owned by B)
 * the first strong owner wins and every unclaimed alias attaches to it, so
 * the conflict reconciles to one TrackId instead of a silent arbitrary pick.
 */
export function resolveTrackId(store: TrackAliasStore, parts: IdentityParts, makeId: () => string): { trackId: string; attached: boolean } {
  const aliases = aliasesFor(parts);
  // pcm-hash first: content identity outranks file-hash, deterministically.
  const strong = [...aliases.filter((a) => a.source === "pcm-hash"), ...aliases.filter((a) => a.source === "file-hash")];
  const strongOwners = new Map<string, string>();

  for (const alias of strong) {
    const owner = store.trackIdForAlias(alias.aliasId);

    if (owner !== null && !strongOwners.has(alias.aliasId)) strongOwners.set(alias.aliasId, owner);
  }
  // First strong alias in pcm-then-file order wins.
  const winner = strong.map((a) => strongOwners.get(a.aliasId)).find((o): o is string => o !== undefined) ?? null;

  for (const alias of [...strong, ...aliases]) {
    const owner = store.trackIdForAlias(alias.aliasId);

    if (owner !== null) {
      const target = winner ?? owner;
      const before = store.aliasesOf(target).length;
      const now = new Date().toISOString();
      const fresh = aliases.filter((a) => store.trackIdForAlias(a.aliasId) === null);
      store.insertMany(fresh.map((a) => ({ trackId: target, aliasId: a.aliasId, source: a.source, createdAt: now })));

      return { trackId: target, attached: store.aliasesOf(target).length > before };
    }
  }

  const trackId = makeId();
  const now = new Date().toISOString();
  store.insertMany(aliases.map((alias) => ({ trackId, aliasId: alias.aliasId, source: alias.source, createdAt: now })));

  return { trackId, attached: false };
}

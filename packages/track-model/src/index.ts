import type { TrackIdentity, TrackModel } from "@autolight/contracts";

// Canonical identity resolution (§12): native ID → path → file hash → PCM
// fingerprint. Never title/artist strings alone.
export function resolveIdentity(parts: {
  rekordboxId?: string;
  seratoPath?: string;
  canonicalPath?: string;
  title?: string;
  artist?: string;
  fileHash?: string;
  pcmFingerprint?: string;
}): TrackIdentity {
  const key = parts.rekordboxId ?? parts.seratoPath ?? parts.canonicalPath ?? parts.fileHash ?? parts.pcmFingerprint;
  if (!key) throw new Error("track identity needs a native id, path, or fingerprint (§12)");
  const id = parts.rekordboxId ? `rb:${parts.rekordboxId}`
    : parts.fileHash ? `hash:${parts.fileHash.slice(0, 16)}`
    : parts.pcmFingerprint ? `pcm:${parts.pcmFingerprint.slice(0, 16)}`
    : `path:${parts.seratoPath ?? parts.canonicalPath}`;
  const identity: TrackIdentity = { id, sourceIds: {} };
  if (parts.rekordboxId) identity.sourceIds.rekordboxId = parts.rekordboxId;
  if (parts.seratoPath) identity.sourceIds.seratoPath = parts.seratoPath;
  if (parts.canonicalPath) identity.canonicalPath = parts.canonicalPath;
  if (parts.title) identity.title = parts.title;
  if (parts.artist) identity.artist = parts.artist;
  if (parts.fileHash) identity.fileHash = parts.fileHash;
  if (parts.pcmFingerprint) identity.pcmFingerprint = parts.pcmFingerprint;
  return identity;
}

// Capability level (§70): FULL → STRUCTURED → ADAPTIVE, never silent failure.
export type Coverage = "full" | "structured" | "adaptive";
export function coverageOf(model: Pick<TrackModel, "beatGrid" | "sections" | "analysisCoverage">): Coverage {
  if (model.analysisCoverage === "full" && model.sections.length > 0) return "full";
  if (model.beatGrid.beats.length > 0) return "structured";
  return "adaptive";
}

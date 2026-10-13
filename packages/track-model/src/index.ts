import type { ReadinessLevel, TrackIdentity, TrackModel } from "@autolight/contracts";

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
  const path = parts.seratoPath ?? parts.canonicalPath;
  const key = parts.rekordboxId ?? path ?? parts.fileHash ?? parts.pcmFingerprint;

  if (!key) throw new Error("track identity needs a native id, path, or fingerprint (§12)");

  const id = parts.rekordboxId ? `rb:${parts.rekordboxId}`
    : path ? `path:${path}`
    : parts.fileHash ? `hash:${parts.fileHash}`
    : `pcm:${parts.pcmFingerprint}`;

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

// Capability level (§70): the worker-issued level, surfaced for UI badges.
// This helper never re-derives the level from grid/section shapes: the
// analysis worker owns readiness, so a declared level is returned as-is and
// cannot contradict it.
export type Coverage = ReadinessLevel;

export function coverageOf(model: Pick<TrackModel, "beatGrid" | "sections" | "analysisCoverage">): Coverage {
  return model.analysisCoverage;
}

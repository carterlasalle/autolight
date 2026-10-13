// Track resolver: live deck to library to cached model (T-RBL-07, DS-22).
//
// Takes whatever a live provider reports (Rekordbox content ID, ANLZ path,
// file path, title and artist, deck and time) and resolves it to a TrackId
// through T-ID-01, then the caller fetches the cached TrackModel and ShowPlan
// (T-RUN-08 fast path). Chain order is DS-22; each step reports confidence
// and which step matched. Ambiguous title-only matches never resolve.
import { resolveTrackId, type IdentityParts, type TrackAliasStore } from "@autolight/track-identity";

export type ResolverStepId =
  | "memory-reader-id"
  | "rekordbox-id"
  | "lighting-ipc-id"
  | "agent-api"
  | "history-table"
  | "path-library"
  | "title-path";

/** DS-22 chain order. `rekordbox-id` and `path-library` keep provenance honest. */
export const RESOLVER_CHAIN: readonly ResolverStepId[] = [
  "memory-reader-id",
  "rekordbox-id",
  "lighting-ipc-id",
  "agent-api",
  "history-table",
  "path-library",
  "title-path",
];

export interface LiveTrackInput {
  /** Native content IDs keyed by which provider reported them. */
  rekordboxId?: string;
  memoryReaderId?: string;
  lightingIpcId?: string;
  agentTrackId?: string;
  historyTrackId?: string;
  /** ANLZ path the provider saw (resolves through the library row). */
  anlzPath?: string;
  filePath?: string;
  canonicalPath?: string;
  title?: string;
  artist?: string;
  fileHash?: string;
  pcmFingerprint?: string;
  /** Lookup hook: native ID to library row identity parts. */
  libraryById?: (rekordboxId: string) => IdentityParts | undefined;
  /** Lookup hook: ANLZ or file path to library row identity parts. */
  libraryByPath?: (path: string) => IdentityParts | undefined;
  /** History table: content IDs seen in djmdSongHistory. */
  historyIds?: ReadonlySet<string>;
  /** Title index: normalized "title|artist" to candidate native IDs. */
  titleIndex?: (title: string, artist?: string) => string[];
}

export interface ResolverStepOutcome {
  step: ResolverStepId;
  matched: boolean;
  confidence: number;
  trackId: string | null;
  note?: string;
}

export interface Resolution {
  trackId: string | null;
  steps: ResolverStepOutcome[];
  /** Which step matched, when one did. */
  matchedStep: ResolverStepId | null;
  confidence: number;
}

/**
 * Resolve a live provider report to a TrackId. ID-bearing steps consult the
 * library row first (so the alias graph sees path and hash), then fall back
 * to the raw ID. The title step only matches a unique candidate; an ambiguous
 * title is reported, never resolved.
 */
export function resolveLiveTrack(
  store: TrackAliasStore,
  input: LiveTrackInput,
  makeId: () => string,
): Resolution {
  const steps: ResolverStepOutcome[] = [];

  const idSteps: { step: ResolverStepId; confidence: number; id: string | undefined }[] = [
    { step: "memory-reader-id", confidence: 1, id: input.memoryReaderId },
    { step: "rekordbox-id", confidence: 1, id: input.rekordboxId },
    { step: "lighting-ipc-id", confidence: 0.95, id: input.lightingIpcId },
    { step: "agent-api", confidence: 0.9, id: input.agentTrackId },
    { step: "history-table", confidence: 0.8, id: input.historyTrackId },
  ];

  for (const { step, confidence, id } of idSteps) {
    if (id === undefined || id === "") {
      steps.push({ step, matched: false, confidence: 0, trackId: null, note: "no id reported" });
      continue;
    }

    if (step === "history-table" && input.historyIds !== undefined && !input.historyIds.has(id)) {
      steps.push({ step, matched: false, confidence: 0, trackId: null, note: "id not in history table" });
      continue;
    }

    let row: IdentityParts | undefined;

    try {
      row = input.libraryById?.(id);
    } catch (err) {
      // A DB/IPC failure in one hook must not abort the whole DS-22 chain.
      steps.push({ step, matched: false, confidence: 0, trackId: null, note: `library lookup failed: ${reasonOf(err)}` });
      continue;
    }

    const { trackId } = resolveWithParts(store, { ...row, rekordboxId: row?.rekordboxId ?? id }, input, makeId);
    steps.push({ step, matched: true, confidence, trackId });

    return { trackId, steps, matchedStep: step, confidence };
  }

  const path = input.canonicalPath ?? input.filePath ?? input.anlzPath;

  if (path !== undefined && path !== "") {
    let row: IdentityParts | undefined;
    let pathLookupFailed = false;

    try {
      row = input.libraryByPath?.(path);
    } catch (err) {
      pathLookupFailed = true;
      steps.push({ step: "path-library", matched: false, confidence: 0, trackId: null, note: `library lookup failed: ${reasonOf(err)}` });
    }

    if (!pathLookupFailed) {
      const outcome: ResolverStepOutcome = row?.rekordboxId !== undefined
        ? { step: "path-library", matched: true, confidence: 0.7, trackId: resolveWithParts(store, row, input, makeId).trackId }
        : {
          step: "path-library",
          matched: false,
          confidence: 0,
          trackId: null,
          note: row === undefined ? "path not in library" : "library row lacks a rekordbox ID",
        };

      steps.push(outcome);

      if (outcome.matched) return { trackId: outcome.trackId, steps, matchedStep: "path-library", confidence: 0.7 };
    }
  }

  if (input.title !== undefined && input.title !== "") {
    let candidates: string[];

    try {
      candidates = (input.artist === undefined ? input.titleIndex?.(input.title) : input.titleIndex?.(input.title, input.artist)) ?? [];
    } catch (err) {
      steps.push({ step: "title-path", matched: false, confidence: 0, trackId: null, note: `title index failed: ${reasonOf(err)}` });

      return { trackId: null, steps, matchedStep: null, confidence: 0 };
    }

    if (candidates.length === 1 && candidates[0] !== undefined) {
      let row: IdentityParts | undefined;

      try {
        row = input.libraryById?.(candidates[0]);
      } catch (err) {
        steps.push({ step: "title-path", matched: false, confidence: 0, trackId: null, note: `library lookup failed: ${reasonOf(err)}` });

        return { trackId: null, steps, matchedStep: null, confidence: 0 };
      }

      // A title-index candidate is a lookup key, not necessarily a Rekordbox
      // content ID: only the library row may become identity aliases.
      if (row === undefined) {
        steps.push({ step: "title-path", matched: false, confidence: 0, trackId: null, note: "title candidate not in library" });

        return { trackId: null, steps, matchedStep: null, confidence: 0 };
      }

      const { trackId } = resolveWithParts(store, row, input, makeId);
      steps.push({ step: "title-path", matched: true, confidence: 0.5, trackId });

      return { trackId, steps, matchedStep: "title-path", confidence: 0.5 };
    }

    steps.push({
      step: "title-path",
      matched: false,
      confidence: 0,
      trackId: null,
      note: candidates.length === 0 ? "no title match" : `ambiguous title: ${candidates.length} candidates`,
    });

    return { trackId: null, steps, matchedStep: null, confidence: 0 };
  }

  steps.push({ step: "title-path", matched: false, confidence: 0, trackId: null, note: "nothing to resolve" });

  return { trackId: null, steps, matchedStep: null, confidence: 0 };
}

/** Row identity plus the caller's hash evidence; every step applies the same merge. */
function resolveWithParts(
  store: TrackAliasStore,
  parts: IdentityParts,
  input: LiveTrackInput,
  makeId: () => string,
): { trackId: string } {
  return resolveTrackId(store, {
    ...parts,
    ...(input.fileHash !== undefined ? { fileHash: input.fileHash } : {}),
    ...(input.pcmFingerprint !== undefined ? { pcmFingerprint: input.pcmFingerprint } : {}),
  }, makeId);
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

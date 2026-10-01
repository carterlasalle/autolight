import type { ShowCue, TrackModel } from "@autolight/contracts";
import { coverageOf } from "@autolight/track-model";

// Library rows (spec 95, T-UI-05): every spec column plus the readiness
// status plus TrackId keying. Wires: track-key.ts keys/selection,
// library.ts rowForTrack status. No fetch here; the screen passes tracks in.

export type QueueState = "Queued" | "Analyzing" | "Compiling" | "Ready" | "Failed";

export interface LibraryTrackRow {
  trackId: string;
  title: string;
  artist: string;
  bpm: number | null;
  key: string | null;
  durationSeconds: number;
  nativeGrid: string;
  nativeStructure: string;
  deepAnalysis: string;
  show: string;
  lastModified: string | null;
  status: "READY" | "ANALYZING" | "NEEDS ANALYSIS" | "GRID WARNING" | "SOURCE MISSING" | "FAILED";
  failReason: string | null;
}

export function libraryTrackRow(opts: {
  track: TrackModel | null;
  gridWarned: boolean;
  sourceMissing: boolean;
  analyzing: boolean;
  failed: string | null;
  deepAnalysis: string;
  show: string;
  lastModified: string | null;
}): LibraryTrackRow {
  const { track } = opts;
  if (opts.failed) {
    return emptyRow(track, opts, "FAILED", opts.failed);
  }
  if (!track) return emptyRow(null, opts, opts.analyzing ? "ANALYZING" : "NEEDS ANALYSIS", null);
  if (opts.sourceMissing) return emptyRow(track, opts, "SOURCE MISSING", null);
  if (opts.gridWarned) return emptyRow(track, opts, "GRID WARNING", null);
  const ready = coverageOf(track) !== "adaptive";
  return emptyRow(track, opts, ready ? "READY" : opts.analyzing ? "ANALYZING" : "NEEDS ANALYSIS", null);
}

function emptyRow(
  track: TrackModel | null,
  opts: { deepAnalysis: string; show: string; lastModified: string | null },
  status: LibraryTrackRow["status"],
  failReason: string | null,
): LibraryTrackRow {
  return {
    trackId: track?.identity.id ?? "",
    title: track?.identity.title ?? "",
    artist: track?.identity.artist ?? "",
    bpm: track?.beatGrid.beats[0]?.bpm ?? null,
    key: null,
    durationSeconds: track?.durationSeconds ?? 0,
    nativeGrid: track && track.beatGrid.beats.length > 0 ? "present" : "missing",
    nativeStructure: track && track.sections.length > 0 ? "present" : "missing",
    deepAnalysis: opts.deepAnalysis,
    show: opts.show,
    lastModified: opts.lastModified,
    status,
    failReason,
  };
}

// Preanalysis queue (spec 139): one entry per queued track. Queue order is
// the selection order; priority moves entries ahead of same-state entries.
export interface QueueEntry {
  trackId: string;
  state: QueueState;
  progress: number;
  failReason: string | null;
  priority: boolean;
}

export function queueEntry(trackId: string): QueueEntry {
  return { trackId, state: "Queued", progress: 0, failReason: null, priority: false };
}

export function advanceQueue(entries: QueueEntry[], trackId: string, next: QueueState, progress: number, failReason: string | null = null): QueueEntry[] {
  return entries.map((e) => (e.trackId === trackId ? { ...e, state: next, progress, failReason } : e));
}

export function prioritiseQueue(entries: QueueEntry[], trackId: string): QueueEntry[] {
  const target = entries.find((e) => e.trackId === trackId);
  if (!target) return entries;
  const marked = entries.map((e) => (e.trackId === trackId ? { ...e, priority: true } : e));
  const rest = marked.filter((e) => e.trackId !== trackId);
  return [{ ...target, priority: true }, ...rest];
}

export function dropFromQueue(entries: QueueEntry[], trackId: string): QueueEntry[] {
  return entries.filter((e) => e.trackId !== trackId);
}

// Upcoming cues per deck (spec 93): cue-relative enrichment kept pure so the
// kit CueList stays a dumb renderer and P-93 two-deck timing is unit pinned.
export interface DeckUpcoming {
  deckId: number;
  label: string;
  cue: ShowCue;
}

export function upcomingForDecks(cuesByDeck: { deckId: number; beat: number; cues: ShowCue[] }[], limit = 5): DeckUpcoming[] {
  const out: DeckUpcoming[] = [];
  for (const d of cuesByDeck) {
    const after = d.cues
      .filter((c) => c.startBeat + c.durationBeats > d.beat)
      .sort((a, b) => a.startBeat - b.startBeat)
      .slice(0, limit);
    for (const cue of after) {
      const delta = Math.max(0, Math.round(cue.startBeat - d.beat));
      out.push({ deckId: d.deckId, label: delta === 0 ? "now" : `in ${delta} beats`, cue });
    }
  }
  return out;
}

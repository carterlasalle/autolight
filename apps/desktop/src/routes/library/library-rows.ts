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

  // A stored model whose source file vanished is a definitive broken state:
  // it outranks ANALYZING (a queued analysis of a missing file is bogus).
  if (opts.sourceMissing) return emptyRow(track, opts, "SOURCE MISSING", null);

  if (opts.analyzing) return emptyRow(track, opts, "ANALYZING", null);

  if (opts.gridWarned) return emptyRow(track, opts, "GRID WARNING", null);
  const ready = coverageOf(track) !== "adaptive";

  return emptyRow(track, opts, ready ? "READY" : "NEEDS ANALYSIS", null);
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
    key: track?.musicalKey?.key ?? null,
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

export interface LiveDeckRow { id: string; title: string; artist: string; readiness: "READY" | "NEEDS ANALYSIS"; bpm: number | null }

export interface LiveDeckSnapshot {
  title: string;
  artist: string;
  readiness: "READY" | "NEEDS ANALYSIS";
  bpm: number | null;
  /** Explicit empty-deck signal; callers that know set `present: false`
  instead of relying on the title text. */
  present?: boolean;
}

/** Empty-deck title shown when no track is loaded (spec 95). */
const EMPTY_DECK_TITLE = "—";

function isDeckPresent(deck: LiveDeckSnapshot | undefined): deck is LiveDeckSnapshot {
  if (!deck) return false;
  if (deck.present !== undefined) return deck.present;

  return deck.title !== EMPTY_DECK_TITLE;
}

// Rows for the decks actually loaded right now (spec 95): title, artist,
// readiness, and BPM come from each deck's own resolved snapshot, never
// parsed out of display text and never copied across decks. Only deck A
// receives the live fallback tempo; deck B keeps its own measurement (null
// reads unmeasured). Query matches title or artist.
export function liveDeckRows(
  decks: LiveDeckSnapshot[],
  fallbackBpm: number | null,
  query: string,
): LiveDeckRow[] {
  const list: LiveDeckRow[] = [
    { id: "deck-a", title: decks[0]?.title ?? EMPTY_DECK_TITLE, artist: decks[0]?.artist ?? "", readiness: decks[0]?.readiness ?? "NEEDS ANALYSIS", bpm: decks[0]?.bpm ?? fallbackBpm },
    ...(isDeckPresent(decks[1])
      ? [{ id: "deck-b", title: decks[1].title, artist: decks[1].artist, readiness: decks[1].readiness, bpm: decks[1].bpm }]
      : []),
  ];

  const q = query.trim().toLowerCase();

  if (!q) return list;

  return list.filter((t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q));
}

// Preanalysis queue (spec 139): one entry per queued track. Queue order is
// the selection order; priority moves the target to the absolute front.
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
  const rest = entries.filter((e) => e.trackId !== trackId);

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

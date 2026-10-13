import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { trackModelSchema, showStyleSchema, type DeckState, type Fixture, type ShowPlan, type TrackModel } from "@autolight/contracts";
import { planShow } from "@autolight/show-planner";
import { BUILT_IN_STYLES } from "@autolight/show-planner";
import { audit } from "./audit-log.js";

// Live show bridge (T-LIVE-02/T-RBL-07/T-RUN-08): turns AX deck readings
// into resolved decks the renderer can display.
//
// Path per readable deck:
//   AX elapsed + title/artist → ANLZ grid (USBANLZ cache by title match)
//   → TrackModel via the analysis worker (pure ANLZ, no audio needed)
//   → ShowPlan via planShow → cached LoadedDeck with live playhead.
//
// Honesty rules: no ANLZ match means no deck (never a fabricated grid);
// no worker means no track (never a guess); the cache holds the last good
// deck per deckId so a transient AX miss coasts instead of blanking.

export interface BridgeDeck {
  state: DeckState;
  track: TrackModel | null;
  plan: ShowPlan | null;
}

export interface BridgeOptions {
  analyze?: (audioPath: string, nativeDir: string | null, trackId: string) => Promise<string | null>;
  styleId?: string;
  shareDir?: string;
}

const USBANLZ_DIR = join(homedir(), "Library", "Pioneer", "rekordbox", "share", "PIONEER", "USBANLZ");

function listAnlzDirs(shareDir: string): string[] {
  const out: string[] = [];

  try {
    for (const bucket of readdirSync(shareDir, { withFileTypes: true })) {
      if (!bucket.isDirectory()) continue;
      const bucketPath = join(shareDir, bucket.name);

      for (const track of readdirSync(bucketPath, { withFileTypes: true })) {
        if (!track.isDirectory()) continue;
        const dat = join(bucketPath, track.name, "ANLZ0000.DAT");

        if (existsSync(dat)) out.push(join(bucketPath, track.name));
      }
    }
  } catch { /* share unreadable: no decks resolve */ }

  return out;
}

function readTrackTitle(nativeDir: string): string | null {
  try {
    const pqtz = join(nativeDir, "ANLZ0000.DAT");
    const buf = readFileSync(pqtz);
    // Track title lives in the PSSI/phrase region as UTF-16; scan for it.
    // Cheap heuristic: longest printable run near the file head.
    const head = buf.subarray(0, Math.min(buf.length, 8192)).toString("utf16le");
    const runs = head.match(/[A-Za-z0-9][A-Za-z0-9 .,'&()-]{3,80}/g) ?? [];
    runs.sort((a, b) => b.length - a.length);

    return runs[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

function normalizeTitle(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export class LiveShowBridge {
  private readonly decks = new Map<number, BridgeDeck>();
  // deckId → the ANLZ dir this deck resolved to: retries keep their
  // assignment, and a second deck can never bind the same unknown-title dir.
  private readonly nativeDirs = new Map<number, string>();
  // deckId → in-flight first-sight resolution so concurrent polls coalesce.
  private readonly inFlight = new Map<number, Promise<BridgeDeck | null>>();
  private anlzDirs: string[] | null = null;
  private analyze: BridgeOptions["analyze"];
  private styleId: string;
  private shareDir: string;

  constructor(opts: BridgeOptions = {}) {
    this.analyze = opts.analyze ?? undefined;
    this.styleId = opts.styleId ?? "house";
    this.shareDir = opts.shareDir ?? USBANLZ_DIR;
  }

  /**
   * Merge late-bound options. The singleton is often constructed before the
   * caller that owns the analyzer arrives; previously those options were
   * discarded and every deck stayed on the no-analyzer miss path forever.
   * The analyzer is single-owner: this only supplies a missing one, so a
   * seam already wired in survives the app's own re-registration on every
   * readLiveShow call.
   */
  applyOptions(opts: BridgeOptions): void {
    this.analyze ??= opts.analyze;
    this.styleId = opts.styleId ?? this.styleId;

    if (opts.shareDir !== undefined && opts.shareDir !== this.shareDir) {
      this.shareDir = opts.shareDir;
      this.anlzDirs = null;
    }
  }

  private dirs(): string[] {
    if (this.anlzDirs === null) this.anlzDirs = listAnlzDirs(this.shareDir);

    return this.anlzDirs;
  }

  /** Resolve a deck reading to a cached deck; analyzes on first sight. */
  async resolveDeck(deckId: number, elapsedSeconds: number | null, readable: boolean, title: string | null): Promise<BridgeDeck | null> {
    if (!readable || elapsedSeconds === null) return this.decks.get(deckId) ?? null;
    const existing = this.decks.get(deckId);
    const playheadSeconds = elapsedSeconds;

    if (existing?.track) {
      const state: DeckState = {
        source: "rekordbox", deckId, track: null, playing: true,
        playheadSeconds, playRate: 1, effectiveBpm: existing.track.beatGrid.beats[0]?.bpm ?? null,
        loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null },
        channelFader: 1, crossfader: null, master: deckId === 1, receivedAtNs: 0n,
      };

      const deck: BridgeDeck = { state, track: existing.track, plan: existing.plan };
      this.decks.set(deckId, deck);

      return deck;
    }

    // Concurrent first sight for the same deck coalesces onto one run: two
    // racing AX polls must not both analyze and overwrite the cache.
    const pending = this.inFlight.get(deckId);

    if (pending) return pending;

    const run = this.resolveFirstSight(deckId, playheadSeconds, title).finally(() => {
      this.inFlight.delete(deckId);
    });

    this.inFlight.set(deckId, run);

    return run;
  }

  /** First sight: bind an ANLZ dir (stable per deck), analyze, plan. */
  private async resolveFirstSight(deckId: number, playheadSeconds: number, title: string | null): Promise<BridgeDeck | null> {
    const dirs = this.dirs();
    // A deck keeps the dir it already resolved to across retries; otherwise
    // prefer a title match (same-track decks may legitimately share one dir),
    // else the first dir no other deck has claimed.
    let nativeDir: string | null = this.nativeDirs.get(deckId) ?? null;

    if (nativeDir === null && title !== null) {
      nativeDir = this.matchByTitle(dirs, title);
    }

    if (nativeDir === null) {
      const taken = new Set(this.nativeDirs.values());
      nativeDir = dirs.find((dir) => !taken.has(dir)) ?? dirs[0] ?? null;
    }

    if (nativeDir !== null) this.nativeDirs.set(deckId, nativeDir);

    // Egress trail, first-sight only: cached coasts stay silent. Each line
    // says where deck data went: no ANLZ match, no analyzer, analysis
    // failed, or resolved with beat count.
    if (!nativeDir) {
      audit("bridge.miss", { deck: deckId, reason: "no-anlz-match" });

      return null;
    }

    if (!this.analyze) {
      audit("bridge.miss", { deck: deckId, reason: "no-analyzer" });

      return null;
    }

    const trackId = `live-deck${deckId}`;
    let artifactPath: string | null = null;
    let analyzeError: string | null = null;

    // The analyzer is injectable and may reject (worker spawn failure,
    // supervisor down); a rejected promise previously escaped resolveDeck
    // entirely. Record it and treat as an honest miss instead.
    try {
      artifactPath = await this.analyze("", nativeDir, trackId);
    } catch (err) {
      analyzeError = err instanceof Error ? err.message : String(err);
    }

    if (!artifactPath) {
      audit("bridge.miss", { deck: deckId, reason: "analysis-failed", error: analyzeError?.slice(0, 200) ?? null });

      return null;
    }

    try {
      // zod validates the payload below: parsing the artifact IS the boundary.
      const raw = JSON.parse(readFileSync(artifactPath, "utf8"));
      const track = trackModelSchema.parse({ ...raw, identity: { id: trackId, sourceIds: {} } });
      const style = showStyleSchema.parse(BUILT_IN_STYLES[this.styleId] ?? BUILT_IN_STYLES["house"]);
      const plan = planShow(track, style);

      const state: DeckState = {
        source: "rekordbox", deckId, track: null, playing: true,
        playheadSeconds, playRate: 1, effectiveBpm: track.beatGrid.beats[0]?.bpm ?? null,
        loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null },
        channelFader: 1, crossfader: null, master: deckId === 1, receivedAtNs: 0n,
      };

      const deck: BridgeDeck = { state, track, plan };
      this.decks.set(deckId, deck);
      audit("bridge.resolved", { deck: deckId, beats: track.beatGrid.beats.length, cues: plan.cues.length });

      return deck;
    } catch (err) {
      // Malformed artifact or schema drift: same observability as the other
      // miss paths — a silent null here hides the failure from diagnostics.
      audit("bridge.miss", { deck: deckId, reason: "artifact-invalid", error: String(err instanceof Error ? err.message : err).slice(0, 200) });

      return null;
    }
  }

  /**
   * Heuristic title match against extracted ANLZ runs. readTrackTitle is a
   * printable-run scan, not a tag parse, so accept only normalized equality,
   * or containment where the contained side is at least 6 characters —
   * short noisy runs otherwise false-positive against unrelated dirs.
   */
  private matchByTitle(dirs: string[], title: string): string | null {
    const lower = normalizeTitle(title);

    for (const dir of dirs) {
      const t = readTrackTitle(dir);

      if (t === null) continue;

      const extracted = normalizeTitle(t);

      if (extracted.length === 0) continue;

      if (extracted === lower || (extracted.length >= 6 && lower.includes(extracted)) || (lower.length >= 6 && extracted.includes(lower))) {
        return dir;
      }
    }

    return null;
  }

  decksSnapshot(): { state: DeckState; track: TrackModel | null; plan: ShowPlan | null }[] {
    return [...this.decks.values()].map((d) => ({ state: d.state, track: d.track, plan: d.plan }));
  }

  fixturesSnapshot(): Fixture[] {
    return [];
  }

  clear(): void {
    this.decks.clear();
    this.nativeDirs.clear();
    this.anlzDirs = null;
  }
}

let bridge: LiveShowBridge | null = null;

export function getLiveShowBridge(opts?: BridgeOptions): LiveShowBridge {
  if (!bridge) {
    bridge = new LiveShowBridge(opts);

    return bridge;
  }

  // Late callers can still supply the analyzer/style/shareDir: the first
  // construction may have happened without them (previously discarded).
  if (opts) bridge.applyOptions(opts);

  return bridge;
}

export function resetLiveShowBridgeForTest(): void {
  bridge = null;
}

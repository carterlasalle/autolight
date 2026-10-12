import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { trackModelSchema, showStyleSchema, type DeckState, type Fixture, type ShowPlan, type TrackModel } from "@autolight/contracts";
import { planShow } from "@autolight/show-planner";
import { BUILT_IN_STYLES } from "@autolight/show-planner";

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

export class LiveShowBridge {
  private readonly decks = new Map<number, BridgeDeck>();
  private anlzDirs: string[] | null = null;
  private readonly analyze: BridgeOptions["analyze"];
  private readonly styleId: string;
  private readonly shareDir: string;

  constructor(opts: BridgeOptions = {}) {
    this.analyze = opts.analyze ?? undefined;
    this.styleId = opts.styleId ?? "house";
    this.shareDir = opts.shareDir ?? USBANLZ_DIR;
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

    // First sight: find the ANLZ set. Prefer title match, else first unclaimed.
    const dirs = this.dirs();
    let nativeDir: string | null = null;

    if (title) {
      const lower = title.toLowerCase();

      for (const dir of dirs) {
        const t = readTrackTitle(dir);

        if (t !== null && (t.toLowerCase().includes(lower) || lower.includes(t.toLowerCase()))) {
          nativeDir = dir;
          break;
        }
      }
    }

    if (!nativeDir) {
      const claimed = new Set([...this.decks.values()].map((d) => (d.track?.identity.id ?? "")));
      nativeDir = dirs.find((dir) => !claimed.has(dir)) ?? dirs[0] ?? null;
    }

    if (!nativeDir || !this.analyze) return null;
    const trackId = `live-deck${deckId}`;
    const artifactPath = await this.analyze("", nativeDir, trackId);

    if (!artifactPath) return null;

    try {
      const raw = JSON.parse(readFileSync(artifactPath, "utf8")) as unknown;
      const track = trackModelSchema.parse({ ...(raw as Record<string, unknown>), identity: { id: trackId, sourceIds: {} } });
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

      return deck;
    } catch {
      return null;
    }
  }

  decksSnapshot(): { state: DeckState; track: TrackModel | null; plan: ShowPlan | null }[] {
    return [...this.decks.values()].map((d) => ({ state: d.state, track: d.track, plan: d.plan }));
  }

  fixturesSnapshot(): Fixture[] {
    return [];
  }

  clear(): void {
    this.decks.clear();
    this.anlzDirs = null;
  }
}

let bridge: LiveShowBridge | null = null;

export function getLiveShowBridge(opts?: BridgeOptions): LiveShowBridge {
  if (!bridge) bridge = new LiveShowBridge(opts);

  return bridge;
}

export function resetLiveShowBridgeForTest(): void {
  bridge = null;
}

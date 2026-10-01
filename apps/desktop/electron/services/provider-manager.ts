import { execFile } from "node:child_process";
import { createSocket, type Socket } from "node:dgram";
import { ServiceTracker, type Service, type ServiceStatus } from "./base.js";

// provider-manager (04-target-architecture section 1): runs the DJ providers
// and exposes their latest readings. The AX deck poller and the PRO DJ LINK
// observer moved here from electron/follow.ts (T-ARC-05); fusion (DS-01) and
// the DeckState emit are T-LIVE-02's job and stay out of this file.

// AX-beat poller (main process, ADR-001 slice 1): osascript reads the deck
// elapsed-time fields from Rekordbox's AX tree at ~1Hz. Reports `readable`
// honestly: denied/empty means the renderer holds preview, never guesses.
export interface AxDeckReading {
  deckId: number;
  elapsedSeconds: number | null;
  playing: boolean | null;
  readable: boolean;
}

function runOsascript(args: string[]): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  execFile("osascript", args, { timeout: 8000 }, (err, stdout) => {
    resolve(err ? "" : stdout.trim());
  });
  return promise;
}

export async function pollAxDecks(): Promise<AxDeckReading[]> {
  // Rekordbox exposes no scriptable windows list; probe both deck clocks.
  // Empty output = unreadable (permissions or layout change), not zero.
  const out = await runOsascript([
    "-e",
    'tell application "System Events" to get value of every static text of window 1 of (first process whose name is "rekordbox")',
  ]);
  if (!out) {
    return [
      { deckId: 1, elapsedSeconds: null, playing: null, readable: false },
      { deckId: 2, elapsedSeconds: null, playing: null, readable: false },
    ];
  }
  // Parse mm:ss / elapsed tokens; fall back to unreadable per-deck.
  const times = [...out.matchAll(/(\d+):(\d{2}(?:\.\d+)?)/g)].map((m) =>
    Number(m[1]) * 60 + Number(m[2]),
  );
  return [1, 2].map((deckId, i) => ({
    deckId,
    elapsedSeconds: times[i] ?? null,
    playing: times[i] !== undefined ? true : null,
    readable: times[i] !== undefined,
  }));
}

// PRO DJ LINK Virtual-CDJ capture (main process, ADR-001 slice 2, after
// Deep Symmetry's dysentery analysis: structures re-derived, never copied).
// :50001 is owned by Rekordbox, so bind with reusePort and only observe:
// 60B beat packets from a link peer give beat-accurate position; mixer-style
// status from Rekordbox-alone yields master BPM only (Bb=0, no playhead).
export interface ProlinkObservation {
  peerPresent: boolean;
  beat: number | null;
  playing: boolean | null;
  bpm: number | null;
}

export function startProlinkWatch(onBeat: (beat: number, bpm: number | null) => void): () => void {
  let socket: Socket | null = null;
  try {
    socket = createSocket({ type: "udp4", reusePort: true });
    socket.on("message", (msg) => {
      // 60-byte beat packet: header "PioneerDJLink" + beat counters.
      // Only trust the shape; ignore anything else on the shared port.
      if (msg.length !== 60) return;
      const nextBeat = msg.readUInt32BE(32);
      const bpmRaw = msg.readUInt16BE(46);
      const bpm = bpmRaw > 0 ? bpmRaw / 100 : null;
      if (Number.isFinite(nextBeat) && nextBeat > 0 && nextBeat < 100000) {
        onBeat(nextBeat, bpm);
      }
    });
    socket.on("error", () => undefined);
    socket.bind(50001);
  } catch {
    socket?.close();
    socket = null;
  }
  return () => {
    try {
      socket?.close();
    } catch { /* already closed */ }
  };
}

export interface ProviderManagerOptions {
  // AX poll period; the ADR-001 slice runs at 1 Hz.
  pollMs?: number;
  // Test seams: production uses the osascript poller and the :50001 observer.
  readDecks?: () => Promise<AxDeckReading[]>;
  watchProlink?: (onBeat: (beat: number, bpm: number | null) => void) => () => void;
}

export interface ProviderReport {
  id: "rekordbox-ax" | "rekordbox-prolink";
  running: boolean;
  detail: string;
}

export class ProviderManager implements Service {
  readonly name = "provider-manager";
  private readonly tracker = new ServiceTracker("provider-manager");
  private axTimer: NodeJS.Timeout | null = null;
  private stopProlink: (() => void) | null = null;
  private readings: AxDeckReading[] = [];
  private observation: ProlinkObservation = { peerPresent: false, beat: null, playing: null, bpm: null };
  private readonly opts: ProviderManagerOptions;

  constructor(opts: ProviderManagerOptions = {}) {
    this.opts = opts;
  }

  start(): ServiceStatus {
    if (this.axTimer === null) {
      const poll = this.opts.readDecks ?? pollAxDecks;
      const tick = async (): Promise<void> => {
        try {
          this.readings = await poll();
          this.tracker.count("axTicks");
          if (this.readings.some((r) => r.readable)) this.tracker.count("axReadable");
        } catch {
          // AX denied: readable:false already reported per deck.
        }
      };
      void tick();
      this.axTimer = setInterval(() => { void tick(); }, this.opts.pollMs ?? 1000);
    }
    if (this.stopProlink === null) {
      const watch = this.opts.watchProlink ?? startProlinkWatch;
      this.stopProlink = watch((beat, bpm) => {
        this.observation = { peerPresent: true, beat, playing: true, bpm };
        this.tracker.count("prolinkBeats");
      });
    }
    this.tracker.set("running", "AX poll at 1 Hz, ProLink observer on :50001 (observe only)");
    return this.status();
  }

  stop(): ServiceStatus {
    if (this.axTimer !== null) clearInterval(this.axTimer);
    this.axTimer = null;
    this.stopProlink?.();
    this.stopProlink = null;
    this.tracker.set("stopped");
    return this.status();
  }

  status(): ServiceStatus {
    this.tracker.setCounter("axRunning", this.axTimer === null ? 0 : 1);
    this.tracker.setCounter("prolinkRunning", this.stopProlink === null ? 0 : 1);
    this.tracker.setCounter("readableDecks", this.readings.filter((r) => r.readable).length);
    this.tracker.setCounter("peerPresent", this.observation.peerPresent ? 1 : 0);
    return this.tracker.status();
  }

  providers(): ProviderReport[] {
    return [
      {
        id: "rekordbox-ax",
        running: this.axTimer !== null,
        detail: this.readings.some((r) => r.readable)
          ? "readable"
          : "unreadable: accessibility permission or Rekordbox layout changed",
      },
      {
        id: "rekordbox-prolink",
        running: this.stopProlink !== null,
        detail: this.observation.peerPresent ? `peer present, bpm ${this.observation.bpm ?? "unknown"}` : "no link peer",
      },
    ];
  }

  latest(): { ax: AxDeckReading[]; prolink: ProlinkObservation } {
    return { ax: this.readings.map((r) => ({ ...r })), prolink: { ...this.observation } };
  }

  // Single poll, used by the follow/ax IPC channel.
  async pollOnce(): Promise<AxDeckReading[]> {
    const poll = this.opts.readDecks ?? pollAxDecks;
    this.readings = await poll();
    this.tracker.count("axTicks");
    return this.latest().ax;
  }
}

let instance: ProviderManager | null = null;

export function getProviderManager(opts: ProviderManagerOptions = {}): ProviderManager {
  instance ??= new ProviderManager(opts);
  return instance;
}

export function resetProviderManagerForTest(): void {
  instance?.stop();
  instance = null;
}

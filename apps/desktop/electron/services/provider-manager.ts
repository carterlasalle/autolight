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

import { connect } from "node:net";

function runOsascript(args: string[]): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  execFile("osascript", args, { timeout: 8000 }, (err, stdout) => {
    resolve(err ? "" : stdout.trim());
  });

  return promise;
}

// ax-decks-helper (tools/ax-helper): a signed, approvable binary that reads
// the deck clocks and serves JSON on 127.0.0.1:45994. The Electron dev binary
// can never appear in Automation approvals, so its osascript calls always
// fail there; the helper CAN be approved once and serves every backend.
interface HelperDeck { deckId: number; elapsed: number | null; remaining: number | null }

function pollHelper(port = 45994, timeoutMs = 3000): Promise<HelperDeck[] | null> {
  const { promise, resolve } = Promise.withResolvers<HelperDeck[] | null>();
  const sock = connect(port, "127.0.0.1", () => { sock.write("poll\n"); });
  let buf = "";

  const done = (v: HelperDeck[] | null): void => {
    try { sock.destroy(); } catch { /* already closed */ }

    resolve(v);
  };

  const timer = setTimeout(() => done(null), timeoutMs);
  sock.on("data", (d) => {
    buf += d.toString();

    if (!buf.includes("\n")) return;
    clearTimeout(timer);

    try {
      const parsed = JSON.parse(buf.trim()) as unknown;

      if (!Array.isArray(parsed)) return done(null);
      done((parsed as Record<string, unknown>[]).map((r) => ({
        deckId: typeof r["deckId"] === "number" ? r["deckId"] as number : 0,
        elapsed: typeof r["elapsed"] === "number" ? r["elapsed"] as number : null,
        remaining: typeof r["remaining"] === "number" ? r["remaining"] as number : null,
      })));
    } catch { done(null); }
  });
  sock.on("error", () => { clearTimeout(timer); done(null); });

  return promise;
}

async function pollAxDecks(): Promise<AxDeckReading[]> {
  // Helper first: the signed ax-decks-helper serves decks the dev binary
  // can never read itself. osascript stays as the fallback for packaged
  // builds where the app itself carries the Automation approval.
  const helped = await pollHelper();

  if (helped !== null && helped.length > 0) {
    return [1, 2].map((deckId) => {
      const deck = helped.find((d) => d.deckId === deckId);
      const elapsedSeconds = deck?.elapsed ?? null;
      const loaded = elapsedSeconds !== null && !(elapsedSeconds === 0 && (deck?.remaining ?? 0) === 0);

      return { deckId, elapsedSeconds: loaded ? elapsedSeconds : null, playing: null, readable: loaded };
    });
  }

  // osascript fallback for packaged builds carrying their own approval.
  const script = [
    'tell application "System Events"',
    '  set o to ""',
    '  repeat with w in (every window of (first process whose name is "rekordbox"))',
    '    try',
    '      repeat with t in (every static text of group 2 of w)',
    '        try',
    '          set v to value of t',
    '          if v is not missing value then set o to o & v & "|"',
    '        end try',
    '      end repeat',
    '    end try',
    '  return o',
    'end tell',
  ].join("\n");

  const out = (await runOsascript(["-e", script])).replace(/\|/g, ",");

  const decks = [...out.matchAll(/(-?\d+:\d{2}),\s*\.(\d)\s*,\s*(\d+:\d{2}),\s*\.(\d)/g)].map(
    (m) => ({ remaining: clockToSeconds(m[1] ?? ""), elapsed: clockToSeconds(m[3] ?? "") }),
  );

  return [1, 2].map((deckId) => {
    const deck = decks[deckId - 1];
    const elapsedSeconds = deck?.elapsed ?? null;

    // Both clocks at zero is the "Not Loaded" idle state, not a track at
    // 0:00 (a loaded deck at cue shows remaining=-duration). Report it
    // unreadable so callers hold preview instead of beat-matching zero.
    const loaded =
      elapsedSeconds !== null && !(elapsedSeconds === 0 && (deck?.remaining ?? 0) === 0);

    return {
      deckId,
      elapsedSeconds: loaded ? elapsedSeconds : null,
      // AX exposes no play-state value; callers diff elapsed across polls.
      playing: null,
      readable: loaded,
    };
  });
}

function clockToSeconds(text: string): number | null {
  const m = /(-?)(\d+):(\d{2})/.exec(text);

  if (!m) return null;
  const seconds = Number(m[2]) * 60 + Number(m[3]);

  return m[1] === "-" ? -seconds : seconds;
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
    socket.on("error", (err: Error) => {
      // EADDRINUSE/ENOTSUP here means Rekordbox owns :50001 without sharing:
      // the observer is deaf, not broken. Record it where Diagnostics reads.
      prolinkBindError = err instanceof Error ? err.message : String(err);
    });
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

// Last :50001 bind failure, when the observer is deaf. Null means the bind
// held (or was never attempted). Read by providers() so Diagnostics names the
// cause instead of showing a silent "no link peer".
let prolinkBindError: string | null = null;

function prolinkBindFailure(): string | null {
  return prolinkBindError;
}

export interface ProviderManagerOptions {
  // AX poll period; the ADR-001 slice runs at 1 Hz.
  pollMs?: number;
  // Test seams: production uses the osascript poller and the :50001 observer.
  readDecks?: () => Promise<AxDeckReading[]>;
  watchProlink?: (onBeat: (beat: number, bpm: number | null) => void) => () => void;
  // Composite FLX4 boot hook: production wires the plug-and-play host from
  // ./composite-flx4-boot.js; omitted in tests, which assert the idle report.
  bootComposite?: () => Promise<CompositeBootResult>;
  stopComposite?: () => Promise<void>;
}

export interface CompositeBootResult {
  connected: boolean;
  portName: string | null;
  detail: string;
}

export interface ProviderReport {
  id: "rekordbox-ax" | "rekordbox-prolink" | "composite-flx4";
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
  private composite: CompositeBootResult | null = null;
  private compositeStarted = false;
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

    if (!this.compositeStarted && this.opts.bootComposite !== undefined) {
      this.compositeStarted = true;
      const boot = this.opts.bootComposite;
      void boot()
        .then((result) => {
          this.composite = result;
          this.tracker.count("compositeBoots");
        })
        .catch(() => {
          // Board absent is steady state: the idle report below covers it.
          this.compositeStarted = false;
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

    if (this.opts.stopComposite !== undefined) {
      const stopComposite = this.opts.stopComposite;
      void stopComposite().catch(() => undefined);
    }

    this.composite = null;
    this.compositeStarted = false;
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
        running: this.stopProlink !== null && prolinkBindFailure() === null,
        detail: prolinkBindFailure() !== null
          ? `deaf on :50001 (${prolinkBindFailure()}); Rekordbox owns the port without sharing — use AX beat or rkbx_link OSC`
          : this.observation.peerPresent ? `peer present, bpm ${this.observation.bpm ?? "unknown"}` : "no link peer",
      },
      {
        id: "composite-flx4",
        running: this.composite?.connected ?? false,
        detail: this.composite?.detail ?? "FLX4 not present, composite idle",
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

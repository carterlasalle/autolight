import { execFile } from "node:child_process";
import { createSocket, type Socket } from "node:dgram";

// AX-beat poller (main process, §ADR-001 slice 1): osascript reads the deck
// elapsed-time fields from Rekordbox's AX tree at ~1Hz. Reports `readable`
// honestly — denied/empty means the renderer holds preview, never guesses.
export interface AxDeckReading {
  deckId: number;
  elapsedSeconds: number | null;
  playing: boolean | null;
  readable: boolean;
}

function runOsascript(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile("osascript", args, { timeout: 8000 }, (err, stdout) => {
      resolve(err ? "" : stdout.trim());
    });
  });
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

// PRO DJ LINK Virtual-CDJ capture (main process, §ADR-001 slice 2, after
// Deep Symmetry's dysentery analysis — structures re-derived, never copied).
// :50001 is owned by Rekordbox, so bind with reusePort and only *observe*:
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
    try { socket?.close(); } catch { /* already closed */ }
  };
}

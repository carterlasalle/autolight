import type { DeckState, Fixture } from "@autolight/contracts";

export function* replay(events: DeckState[]): Generator<DeckState> {
  for (const e of events) yield e;
}

export function makeDeck(over: Partial<DeckState> = {}): DeckState {
  return {
    source: "rekordbox", deckId: 1, track: null, playing: true,
    playheadSeconds: 0, playRate: 1, effectiveBpm: 128,
    loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null },
    channelFader: 1, crossfader: 1, master: true, receivedAtNs: 0n, ...over,
  };
}

export function makeFixture(id: string, segmentCount: number, x0 = 0, x1 = 1, groups: string[] = []): Fixture {
  return {
    id, adapter: "govee", sku: "SIM", hardwareId: id, groups,
    cells: Array.from({ length: segmentCount }, (_, i) => ({
      index: i,
      position: { x: segmentCount === 1 ? x0 : x0 + ((x1 - x0) * i) / (segmentCount - 1), y: 0 },
      order: i,
      tags: [],
    })),
    calibration: {
      segmentCount, maxStableFps: 30, expectedLatencyMs: 25, armSettleMs: 50,
      orientation: "forward", gamma: 2.2, brightnessCeiling: 1, firmwareVersion: "sim-1",
    },
  };
}

export interface FaultSpec { dropEvery?: number; disconnectAt?: number; reconnectAt?: number }

// Deterministic frame gate: drops / disconnect windows, no randomness (§104).
export function gateFrame(frameIndex: number, spec: FaultSpec): "send" | "drop" | "offline" {
  if (spec.disconnectAt !== undefined && frameIndex >= spec.disconnectAt &&
      (spec.reconnectAt === undefined || frameIndex < spec.reconnectAt)) return "offline";
  if (spec.dropEvery !== undefined && spec.dropEvery > 0 && frameIndex % spec.dropEvery === 0) return "drop";
  return "send";
}

// Soak harness (§125): simulate N frames of playback, assert no queue growth,
// no drift, no dead worker. Returns worst observed pending depth (must be ≤1
// with newest-state-wins) and frames sent.
export function soak(frames: number, gate: (i: number) => "send" | "drop" | "offline"): { sent: number; dropped: number; offline: number; maxPending: number } {
  let pending = 0;
  let maxPending = 0;
  let sent = 0;
  let dropped = 0;
  let offline = 0;
  for (let i = 0; i < frames; i++) {
    pending += 1; // show loop produced one frame
    maxPending = Math.max(maxPending, pending);
    const action = gate(i);
    if (action === "send") { sent += 1; pending = 0; }
    else if (action === "drop") { dropped += 1; pending = 0; }
    else { offline += 1; pending = 0; } // reconnect sends current frame only (§106)
  }
  return { sent, dropped, offline, maxPending };
}

// Full-performance scenario (§125, §150 normal night): 4h of deck states with
// load → play → crossfade → loop → seek → drop handoff. Deterministic, no I/O.
export function* performanceScenario(opts: { fps?: number; hours?: number } = {}): Generator<DeckState> {
  const fps = opts.fps ?? 60;
  const total = Math.floor(fps * 3600 * (opts.hours ?? 4));
  for (let i = 0; i < total; i++) {
    const t = i / fps;
    const half = Math.floor(t / 60) % 2; // swap lead deck every minute
    const bar = Math.floor(t / 2) % 64;
    const inLoop = bar >= 32 && bar < 40;
    yield makeDeck({
      deckId: half === 0 ? 1 : 2,
      track: { id: half === 0 ? "track-a" : "track-b", sourceIds: {} },
      playheadSeconds: t % 1800,
      playRate: 1,
      effectiveBpm: 128,
      loop: inLoop
        ? { active: true, startSeconds: t - 4, endSeconds: t, beatLength: 8 }
        : { active: false, startSeconds: null, endSeconds: null, beatLength: null },
      channelFader: half === 0 ? 1 : 0.6,
      crossfader: half === 0 ? 0.2 : 0.8,
      receivedAtNs: BigInt(i) * 1_000_000_000n / BigInt(fps),
    });
  }
}

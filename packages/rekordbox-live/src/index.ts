import { z } from "zod";
import type { DeckState } from "@autolight/contracts";
import { deckStateSchema } from "@autolight/contracts";
import { rowToIdentity } from "@autolight/rekordbox-library";

// Protocol fixture envelope. Raw capture is required: a fixture with an
// empty capture fails the fixture lint (T-TRU-15, T-QA-03), and replay
// decodes the capture rather than echoing expectations. expectedEvents are
// human-written DeckState snapshots (receivedAtNs excluded: replay stamps
// its own clock), each carrying expectedBy naming the human author.
const fixtureSchema = z.object({
  rekordboxVersion: z.string(),
  platform: z.enum(["macos", "windows"]),
  action: z.string(),
  capture: z.string().min(1, "empty capture: record the raw transport bytes"),
  expectedEvents: z.array(deckStateSchema.omit({ receivedAtNs: true })),
  expectedBy: z.string().min(1).optional(),
});
export type ProtocolFixture = z.infer<typeof fixtureSchema>;

export function parseFixture(raw: unknown): ProtocolFixture {
  return fixtureSchema.parse(raw);
}

// Deterministic replay at 1×/2×/10×/step (§128): stamp events with a virtual
// clock so CI needs no DJ software. Returns full DeckState incl. receivedAtNs.
export function replayFixture(fixture: ProtocolFixture, rate = 1, stepMs = 100): DeckState[] {
  const baseNs = 1_000_000_000n;
  return fixture.expectedEvents.map((e, i) => ({
    ...e,
    receivedAtNs: baseNs + BigInt(Math.round((i * stepMs * 1_000_000) / rate)),
  }));
}

// Unknown-field retention (§9.5): decoder output keeps raw alongside normalized.
export interface DecodedMessage {
  state: DeckState;
  raw: Record<string, unknown>;
}

// Provider contract (§6): no downstream component knows how state was obtained.
export interface LiveProvider {
  readonly id: string;
  readonly source: "rekordbox" | "serato";
  start(): Promise<void>;
  stop(): Promise<void>;
  getDecks(): readonly DeckState[];
  onDeckState(listener: (state: DeckState) => void): () => void;
  onConnection(listener: (up: boolean) => void): () => void;
}

// Version-aware protocol definitions (§146): unknown versions probe but are
// never declared supported until replay/live qualification passes.
export interface ProtocolDefinition {
  versionRange: string;
  platform: "macos" | "windows";
  supported: boolean;
}

export function isSupported(def: ProtocolDefinition, version: string, platform: "macos" | "windows"): boolean {
  return def.supported && def.platform === platform && version.startsWith(def.versionRange.replace("x", ""));
}

export function unverifiedWarning(version: string): string {
  return `UNVERIFIED REKORDBOX VERSION ${version} (§145)`;
}

// Composite FLX4 provider (§10): library identity + MIDI transport hints +
// native beatgrid → DeckState. Proven live 2026-09-29 against Rekordbox
// 7.2.10: resolves both loaded SoundCloud tracks to grids/phrases.
// MIDI is secondary truth (§11): faders/transport confirm, never override.
export interface CompositeSnapshot {
  deckId: number;
  row: { rekordboxId: string; canonicalPath?: string; title?: string; artist?: string };
  playing: boolean;
  playheadSeconds: number;
  playRate: number;
  effectiveBpm: number | null;
  channelFader: number | null;
  crossfader: number | null;
  receivedAtNs: bigint;
}

export function compositeToDeckState(snap: CompositeSnapshot): DecodedMessage {
  const id = rowToIdentity(snap.row);
  return {
    state: {
      source: "rekordbox",
      deckId: snap.deckId,
      track: {
        id: `rb:${id.rekordboxId}`,
        sourceIds: { rekordboxId: id.rekordboxId },
        ...(id.canonicalPath ? { canonicalPath: id.canonicalPath } : {}),
        ...(id.title ? { title: id.title } : {}),
        ...(id.artist ? { artist: id.artist } : {}),
      },
      playing: snap.playing,
      playheadSeconds: snap.playheadSeconds,
      playRate: snap.playRate,
      effectiveBpm: snap.effectiveBpm,
      loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null },
      channelFader: snap.channelFader,
      crossfader: snap.crossfader,
      master: null,
      receivedAtNs: snap.receivedAtNs,
    },
    raw: { provider: "composite-flx4", row: snap.row },
  };
}

// AX-beat poller (§ADR-001 slice 1): coarse playhead from the deck's elapsed
// time field. Main process polls Rekordbox's AX tree (~1Hz); this module maps
// elapsed seconds onto the ANLZ grid and reports permission state honestly.
// Accuracy ±1 beat. `readable: false` means AX denied/empty → caller holds
// preview instead of guessing.
export interface AxBeatSample {
  deckId: number;
  elapsedSeconds: number | null;
  playing: boolean | null;
  readable: boolean;
  sampledAtNs: bigint;
}

export function axBeatToPlayhead(sample: AxBeatSample, grid: { sourceTimeMs: number }[]): number | null {
  if (!sample.readable || sample.elapsedSeconds === null) return null;
  const t = sample.elapsedSeconds * 1000;
  let beat = 1;
  for (let i = 0; i < grid.length; i++) {
    if ((grid[i]?.sourceTimeMs ?? Infinity) <= t) beat = i + 1;
    else break;
  }
  return beat;
}

// PRO DJ LINK Virtual-CDJ capture (§ADR-001 slice 2, after Deep Symmetry's
// dysentery analysis + MIT supertimecodeconverter patterns — study-only for
// EPL beat-link core, never copied). Beat packets (60B, :50001) give
// beat-accurate position when a link peer emits; Rekordbox-alone sends
// mixer-style status (master BPM, Bb=0) so full position needs a peer/CDJ.
export interface ProlinkBeatPacket {
  deviceNumber: number;
  nextBeat: number;
  secondBeat: number;
  pitchBpm: number | null;
  receivedAtNs: bigint;
}

export interface ProlinkStatus {
  deviceName: string;
  deviceNumber: number;
  masterBpm: number | null;
  beatInBar: number;
  peerPresent: boolean;
  receivedAtNs: bigint;
}

export type FollowSource = "preview" | "ax-beat" | "prolink";

// Combined transport: prolink beats win when a peer emits, AX elapsed wins
// when readable, otherwise the estimator coasts the last known beat at grid
// tempo. Never fabricates: `beat: null` means unknown, UI holds preview.
export interface CombinedTransport {
  source: FollowSource;
  beat: number | null;
  playing: boolean | null;
  bpm: number | null;
}

export function combineTransport(opts: {
  prolink: { beat: number | null; playing: boolean | null; bpm: number | null; peerPresent: boolean };
  ax: { beat: number | null; playing: boolean | null };
  estimatedBeat: number | null;
  estimatedBpm: number | null;
}): CombinedTransport {
  if (opts.prolink.peerPresent && opts.prolink.beat !== null) {
    return { source: "prolink", beat: opts.prolink.beat, playing: opts.prolink.playing, bpm: opts.prolink.bpm ?? opts.estimatedBpm };
  }
  if (opts.ax.beat !== null) {
    return { source: "ax-beat", beat: opts.ax.beat, playing: opts.ax.playing, bpm: opts.estimatedBpm };
  }
  return { source: "preview", beat: opts.estimatedBeat, playing: null, bpm: opts.estimatedBpm };
}

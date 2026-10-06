import { z } from "zod";
import type { DeckState } from "@autolight/contracts";
import { deckStateSchema } from "@autolight/contracts";
import { axFractionalBeat } from "./ax.js";

// Library row identity inline (§12 resolution starts at native ID plus path).
// Inlined here so the live package never imports the file-reading library
// plane (pssi labels, sidecar, watchers pull node:fs into the renderer
// bundle). The canonical resolver lives in @autolight/track-identity.
function rowToIdentity(row: { rekordboxId: string; canonicalPath?: string; title?: string; artist?: string }): { rekordboxId: string; canonicalPath?: string; title?: string; artist?: string } {
  const out: { rekordboxId: string; canonicalPath?: string; title?: string; artist?: string } = { rekordboxId: row.rekordboxId };
  if (row.canonicalPath !== undefined && row.canonicalPath !== "") out.canonicalPath = row.canonicalPath;
  if (row.title !== undefined && row.title !== "") out.title = row.title;
  if (row.artist !== undefined && row.artist !== "") out.artist = row.artist;
  return out;
}

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

// Step mode (§128): the same virtual clock, but one event per call so a
// harness can advance by hand and inspect between events.
export function* replayFixtureStep(fixture: ProtocolFixture, stepMs = 100): Generator<DeckState> {
  for (const state of replayFixture(fixture, 1, stepMs)) yield state;
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

// AX-beat poller plus combined-transport math live in ./follow.js, the
// browser-safe module with no node: imports (T-TRU-04 spine fix). The
// renderer imports that file directly; this re-export keeps existing
// main-process imports resolving.
export {
  axBeatToPlayhead,
  combineTransport,
  type AxBeatSample,
  type CombinedTransport,
  type FollowSource,
} from "./follow.js";

// T-LIVE-01 to T-LIVE-08 surface: provider contract and shared suite, the
// DS-01 fusion engine and manager, the rkbx_link OSC consumer with its setup
// verification, the PRO DJ LINK decoder and provider, the AX tree reader and
// provider, and the Rekordbox agent API client.
export * from "./providers.js";
export * from "./contract-suite.js";
export * from "./fusion.js";
export * from "./osc.js";
export * from "./rkbx-osc.js";
export * from "./setup-assistant.js";
export * from "./prolink.js";
export * from "./prolink-provider.js";
export * from "./ax.js";
export * from "./ax-provider.js";
export * from "./agent-api.js";
export * from "./composite.js";

import { z } from "zod";
import type { DeckState } from "@autolight/contracts";
import { deckStateSchema } from "@autolight/contracts";

// Protocol fixture envelope (§9.4). Raw capture stays opaque until the
// Lighting decoder lands; expectedEvents are normalized DeckState snapshots
// (receivedAtNs excluded — replay stamps its own clock).
const fixtureSchema = z.object({
  rekordboxVersion: z.string(),
  platform: z.enum(["macos", "windows"]),
  action: z.string(),
  capture: z.string(),
  expectedEvents: z.array(deckStateSchema.omit({ receivedAtNs: true })),
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

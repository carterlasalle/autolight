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

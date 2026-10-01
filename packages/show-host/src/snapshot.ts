// Versioned show snapshot for the UI (T-ARC-04, spec 92, 108).
//
// The show host publishes HostSnapshot (tick, decks, owner, weights, per-cell
// colors) at runtime.snapshot.uiRateHz, latest wins. This module wraps that
// payload in a versioned UI snapshot that also carries cursors, the current
// section plus upcoming cues per deck, device health, and host metrics, with
// serialize/parse and a size plus timing check against
// runtime.snapshot.maxBytes.
//
// Per-cell colors are the logical renderer output before per-device
// calibration: calibration (gamma, brightness ceiling) is applied downstream
// in the device path, never here, so P-92 can compare snapshot cells against
// the transport frame byte for byte.

import { Buffer } from "node:buffer";
import { z } from "zod";
import {
  deckSnapshotSchema,
  hostMetricsSchema,
  hostSnapshotSchema,
  type HostMetrics,
  type HostSnapshot,
} from "./index.js";
import type { ShowPlan, TrackModel } from "@autolight/contracts";

// runtime.snapshot defaults from docs/finish/03-config-and-decisions.md.
export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_MAX_BYTES = 262144;
export const SNAPSHOT_UI_RATE_HZ = 30;
export const UPCOMING_CUE_LIMIT = 8;

export const snapshotCursorSchema = z.object({
  beat: z.number(),
  loopPass: z.number().int(),
  scratchHold: z.boolean(),
});
export type SnapshotCursor = z.infer<typeof snapshotCursorSchema>;

export const snapshotSectionSchema = z.object({
  kind: z.string().min(1),
  rawLabel: z.string().optional(),
  startBeat: z.number(),
  endBeat: z.number(),
});
export type SnapshotSection = z.infer<typeof snapshotSectionSchema>;

export const upcomingCueSchema = z.object({
  type: z.string().min(1),
  startBeat: z.number(),
  beatsUntil: z.number(),
  secondsUntil: z.number().nullable(),
  intensity: z.number(),
  target: z.string().min(1),
  priority: z.number(),
});
export type UpcomingCue = z.infer<typeof upcomingCueSchema>;

export const snapshotDeckSchema = deckSnapshotSchema.extend({
  cursor: snapshotCursorSchema,
  section: snapshotSectionSchema.nullable(),
  upcomingCues: z.array(upcomingCueSchema),
});
export type SnapshotDeck = z.infer<typeof snapshotDeckSchema>;

export const deviceHealthSchema = z.object({
  hardwareId: z.string().min(1),
  health: z.enum(["online", "degraded", "offline"]),
  fps: z.number(),
});
export type DeviceHealth = z.infer<typeof deviceHealthSchema>;

export const uiSnapshotSchema = hostSnapshotSchema.extend({
  version: z.literal(SNAPSHOT_VERSION),
  decks: z.array(snapshotDeckSchema),
  deviceHealth: z.array(deviceHealthSchema),
  metrics: hostMetricsSchema.nullable(),
});
export type UiSnapshot = z.infer<typeof uiSnapshotSchema>;

export interface UiSnapshotContext {
  readonly plans?: ReadonlyMap<number, ShowPlan | null>;
  readonly models?: ReadonlyMap<number, TrackModel | null>;
  readonly deviceHealth?: readonly DeviceHealth[];
  readonly metrics?: HostMetrics | null;
}

// Current section at a beat, or null when the model has no coverage there.
export function currentSection(model: TrackModel | null | undefined, beat: number): SnapshotSection | null {
  if (!model) return null;
  const found = model.sections.find((s) => beat >= s.startBeat && beat < s.endBeat);
  if (!found) return null;
  return {
    kind: found.kind,
    ...(found.rawLabel !== undefined ? { rawLabel: found.rawLabel } : {}),
    startBeat: found.startBeat,
    endBeat: found.endBeat,
  };
}

export interface UpcomingCueOptions {
  readonly limit?: number;
  readonly effectiveBpm?: number | null;
  readonly playRate?: number;
}

// Cues starting after this beat, soonest first. secondsUntil assumes the
// current rate holds and is null when no rate applies (paused, unknown bpm).
export function selectUpcomingCues(
  plan: ShowPlan | null | undefined,
  beat: number,
  opts: UpcomingCueOptions = {},
): UpcomingCue[] {
  if (!plan) return [];
  const limit = opts.limit ?? UPCOMING_CUE_LIMIT;
  const bpm = opts.effectiveBpm ?? null;
  const rate = opts.playRate ?? 1;
  return plan.cues
    .filter((c) => c.startBeat > beat)
    .sort((a, b) => a.startBeat - b.startBeat || b.priority - a.priority)
    .slice(0, Math.max(0, limit))
    .map((c) => {
      const beatsUntil = c.startBeat - beat;
      const secondsUntil = bpm !== null && bpm > 0 && rate > 0 ? beatsUntil / (bpm / 60) / rate : null;
      return {
        type: c.type,
        startBeat: c.startBeat,
        beatsUntil,
        secondsUntil,
        intensity: c.intensity,
        target: c.target,
        priority: c.priority,
      };
    });
}

export function latestPublishedSnapshot(snapshots: readonly HostSnapshot[]): HostSnapshot | null {
  if (snapshots.length === 0) return null;
  let latest = snapshots[0]!;
  for (const snapshot of snapshots) {
    if (snapshot.tick > latest.tick) latest = snapshot;
  }
  return latest;
}

export function buildUiSnapshot(host: HostSnapshot, ctx: UiSnapshotContext = {}): UiSnapshot {
  const decks: SnapshotDeck[] = host.decks.map((deck) => {
    const plan = ctx.plans?.get(deck.deckId) ?? null;
    const model = ctx.models?.get(deck.deckId) ?? null;
    return {
      ...deck,
      cursor: { beat: deck.beat, loopPass: deck.loopPass, scratchHold: false },
      section: currentSection(model, deck.beat),
      upcomingCues: selectUpcomingCues(plan, deck.beat, {
        effectiveBpm: deck.effectiveBpm,
        playRate: deck.playRate,
      }),
    };
  });
  return {
    ...host,
    version: SNAPSHOT_VERSION,
    decks,
    deviceHealth: ctx.deviceHealth ? [...ctx.deviceHealth] : [],
    metrics: ctx.metrics ?? null,
  };
}

export interface SerializedSnapshot {
  readonly json: string;
  readonly bytes: number;
  readonly elapsedMs: number;
}

export function serializeSnapshot(snapshot: UiSnapshot): SerializedSnapshot {
  const hasPerf = typeof performance !== "undefined" && typeof performance.now === "function";
  const start = hasPerf ? performance.now() : Date.now();
  const json = JSON.stringify(snapshot);
  const end = hasPerf ? performance.now() : Date.now();
  return { json, bytes: Buffer.byteLength(json, "utf8"), elapsedMs: end - start };
}

export interface SnapshotBudget {
  readonly bytes: number;
  readonly elapsedMs: number;
  readonly maxBytes: number;
  readonly withinBudget: boolean;
}

export function measureSnapshot(snapshot: UiSnapshot, maxBytes: number = SNAPSHOT_MAX_BYTES): SnapshotBudget {
  const serialized = serializeSnapshot(snapshot);
  return {
    bytes: serialized.bytes,
    elapsedMs: serialized.elapsedMs,
    maxBytes,
    withinBudget: serialized.bytes <= maxBytes,
  };
}

// Wrong versions and malformed payloads throw; callers treat that as a
// resubscribe trigger, never as a renderable frame.
export function parseSnapshot(json: string): UiSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch (err) {
    throw new Error(`snapshot parse: invalid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  const parsed = uiSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`snapshot parse: ${parsed.error.message}`);
  }
  return parsed.data;
}

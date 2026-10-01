// AutoLight show host (T-ARC-01, DS-07).
//
// One 60 Hz tick pipeline (hrtime clock, deck worlds with latest-wins DeckState
// ingest, estimator, cursor, overrides, mixer, renderer, snapshot publisher)
// that communicates over MessagePort with the typed protocol from
// packages/ipc. The same entry runs in three modes:
//
//   worker-thread            Node worker_threads Worker created by main
//   utility-process          Electron utilityProcess
//   utility-process-worker   utilityProcess whose tick pipeline runs on a
//                            worker thread bridged through the utility process
//
// Native addons (govee-toolkit napi, BLE backends) are probed per mode. A mode
// whose addons cannot load reports `unavailable` with the reason; no silent
// fallback to another mode anywhere in this package.

import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { MessageChannel, type MessagePort } from "node:worker_threads";
import { z } from "zod";
import {
  deckStateSchema,
  fixtureSchema,
  showPlanSchema,
  type DeckState,
  type Fixture,
  type ShowPlan,
} from "@autolight/contracts";
import { audibleWeight, estimatePosition } from "@autolight/dj-core";
import { channelNames, channels, type Channel } from "@autolight/ipc";
import { renderFrame } from "@autolight/renderer";
import { baseWeights, mixDown, type DeckMix, type MixResult } from "@autolight/show-mixer";
import {
  clockHealth,
  evaluateCues,
  quantizeResume,
  trackDeck,
  type CursorState,
  type OverrideKind,
  type ResumeAt,
} from "@autolight/show-runtime";

// ---------------------------------------------------------------------------
// Modes (DS-07)

export const HOST_MODES = ["worker-thread", "utility-process", "utility-process-worker"] as const;
export type HostMode = (typeof HOST_MODES)[number];

// ---------------------------------------------------------------------------
// Native addon probing (T-ARC-01: verify per mode, report unavailable)

export const PROBE_IDS = ["govee-toolkit", "ble-toolkit-ble", "ble-noble"] as const;
export type ProbeId = (typeof PROBE_IDS)[number];

export interface ProbeResult {
  readonly id: ProbeId;
  readonly available: boolean;
  readonly reason: string | null;
}

export type AddonProbe = (id: ProbeId) => ProbeResult;

export interface ModeStatus {
  readonly mode: HostMode;
  readonly available: boolean;
  readonly reason: string | null;
  readonly probes: ProbeResult[];
}

export const modeProbeIds: Record<HostMode, readonly ProbeId[]> = {
  "worker-thread": PROBE_IDS,
  "utility-process": PROBE_IDS,
  "utility-process-worker": PROBE_IDS,
};

function unavailable(id: ProbeId, reason: string): ProbeResult {
  return { id, available: false, reason };
}

function available(id: ProbeId): ProbeResult {
  return { id, available: true, reason: null };
}

// Probe the real native modules. govee-toolkit ships one prebuilt addon whose
// BLE binding is enabled per build (wp04-ble-matter-cloud-failover.md T-BLE-01);
// noble is the fallback backend. None of these are loaded eagerly anywhere;
// the probe is the only loading point and each failure is recorded with its
// reason so the mode reports `unavailable` instead of silently running.
// The three probed modules are runtime-selected native addons that do not
// exist in every environment (they are not installed in this repo yet), so a
// static import cannot work; createRequire keeps the probe lazy and loud.
const requireNativeAddon = createRequire(import.meta.url);

export function defaultAddonProbe(id: ProbeId): ProbeResult {
  try {
    if (id === "govee-toolkit") {
      const toolkit = requireNativeAddon("govee-toolkit") as unknown;
      if (toolkit === null || typeof toolkit !== "object") {
        return unavailable(id, "govee-toolkit module exports no object");
      }
      return available(id);
    }
    if (id === "ble-toolkit-ble") {
      const toolkit = requireNativeAddon("govee-toolkit") as { ble?: unknown };
      if (toolkit.ble === undefined) {
        return unavailable(id, "govee-toolkit was built without the ble binding");
      }
      return available(id);
    }
    const noble = requireNativeAddon("@stoprocent/noble") as unknown;
    if (noble === null || typeof noble !== "object") {
      return unavailable(id, "@stoprocent/noble exports no object");
    }
    return available(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return unavailable(id, message);
  }
}

export function probeMode(mode: HostMode, probe: AddonProbe = defaultAddonProbe): ModeStatus {
  const results = modeProbeIds[mode].map((id) => probe(id));
  const failed = results.filter((result) => !result.available);
  if (failed.length > 0) {
    const reason = failed.map((result) => `${result.id}: ${result.reason ?? "unknown failure"}`).join("; ");
    return { mode, available: false, reason, probes: results };
  }
  return { mode, available: true, reason: null, probes: results };
}

// ---------------------------------------------------------------------------
// MessagePort host protocol (typed, validated both directions)

const wireDeckStateSchema = deckStateSchema.extend({
  receivedAtNs: z.string().regex(/^-?\d+$/, "receivedAtNs must be a decimal integer string"),
});

export const hostInboundMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("deck"),
    deckId: z.number().int(),
    state: wireDeckStateSchema,
  }),
  z.object({
    type: z.literal("plan"),
    deckId: z.number().int(),
    generation: z.number().int(),
    plan: showPlanSchema.nullable(),
  }),
  z.object({
    type: z.literal("fixtures"),
    generation: z.number().int(),
    fixtures: z.array(fixtureSchema),
  }),
  z.object({
    type: z.literal("intent"),
    channel: z.enum(channelNames() as [Channel, ...Channel[]]),
    request: z.unknown(),
  }),
  z.object({ type: z.literal("close"), reason: z.string() }),
]);
export type HostInboundMessage = z.infer<typeof hostInboundMessageSchema>;

const OVERRIDE_KINDS = ["none", "blackout", "white", "freeze", "force-low", "force-high"] as const;
const CLOCK_HEALTHS = ["live", "extrapolating", "holding", "degraded"] as const;

export const deckSnapshotSchema = z.object({
  deckId: z.number().int(),
  beat: z.number(),
  loopPass: z.number().int(),
  playing: z.boolean(),
  playRate: z.number(),
  effectiveBpm: z.number().nullable(),
  override: z.enum(OVERRIDE_KINDS),
  clockHealth: z.enum(CLOCK_HEALTHS),
});
export type DeckSnapshot = z.infer<typeof deckSnapshotSchema>;

export const cellSnapshotSchema = z.object({
  fixtureId: z.string(),
  cellIndex: z.number().int(),
  color: z.tuple([z.number(), z.number(), z.number()]),
});
export type CellSnapshot = z.infer<typeof cellSnapshotSchema>;

export const hostSnapshotSchema = z.object({
  tick: z.number().int(),
  tMs: z.number(),
  mode: z.enum(HOST_MODES),
  decks: z.array(deckSnapshotSchema),
  owner: z.string().nullable(),
  weights: z.object({ a: z.number(), b: z.number() }),
  cells: z.array(cellSnapshotSchema),
});
export type HostSnapshot = z.infer<typeof hostSnapshotSchema>;

export const hostMetricsSchema = z.object({
  ticks: z.number().int(),
  snapshotsPublished: z.number().int(),
  supersededFrames: z.number().int(),
  intervalP50Ms: z.number(),
  intervalP99Ms: z.number(),
  intervalMaxMs: z.number(),
  missedTicksPerHour: z.number(),
});
export type HostMetrics = z.infer<typeof hostMetricsSchema>;

export const hostOutboundMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), snapshot: hostSnapshotSchema }),
  z.object({ type: z.literal("metrics"), metrics: hostMetricsSchema }),
  z.object({ type: z.literal("error"), error: z.object({ code: z.string(), message: z.string() }) }),
  z.object({ type: z.literal("response"), channel: z.string(), response: z.unknown() }),
]);
export type HostOutboundMessage = z.infer<typeof hostOutboundMessageSchema>;

// ---------------------------------------------------------------------------
// Port plumbing

// Narrow adapter over node:worker_threads MessagePort / Electron parentPort
// so the host is testable with in-memory doubles.
export interface HostPort {
  readonly connected: boolean;
  readonly supervised: boolean;
  postMessage(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
  onClose(listener: () => void): void;
  onError(listener: (error: Error) => void): void;
  close(): void;
}

export function wrapMessagePort(port: MessagePort, supervised: boolean): HostPort {
  return {
    connected: true,
    supervised,
    postMessage(message: unknown): void {
      port.postMessage(message);
    },
    onMessage(listener: (message: unknown) => void): void {
      port.on("message", (message) => listener(message));
    },
    onClose(listener: () => void): void {
      port.on("close", () => listener());
    },
    onError(listener: (error: Error) => void): void {
      port.on("error", (error) => listener(error));
    },
    close(): void {
      port.close();
    },
  };
}

export interface PortBusOptions {
  readonly validateOutbound: (message: unknown) => string | null;
  readonly onGone: (reason: string) => void;
}

// Fan-out from host to every attached port. Outbound messages validate
// against the typed protocol before posting; a supervised port dying (killed
// process, closed channel) fires the crash-policy hook exactly once.
export class PortBus {
  private readonly ports: HostPort[] = [];
  private ended = false;

  constructor(private readonly options: PortBusOptions) {}

  attach(port: HostPort, onInbound: (message: unknown) => void): void {
    if (this.ended) return;
    this.ports.push(port);
    port.onMessage((message) => onInbound(message));
    port.onClose(() => this.drop(port, "port closed by remote"));
    port.onError((error) => this.drop(port, `port error: ${error.message}`));
  }

  send(message: unknown): void {
    if (this.ended) return;
    const error = this.options.validateOutbound(message);
    if (error !== null) {
      throw new Error(`show host refused to send invalid message: ${error}`);
    }
    for (const port of this.ports) {
      if (port.connected) port.postMessage(message);
    }
  }

  close(): void {
    this.ended = true;
    this.ports.splice(0, this.ports.length);
  }

  private drop(port: HostPort, reason: string): void {
    const index = this.ports.indexOf(port);
    if (index >= 0) this.ports.splice(index, 1);
    if (this.ended) return;
    if (port.supervised) {
      this.ended = true;
      this.options.onGone(reason);
    }
  }
}

// ---------------------------------------------------------------------------
// Show host

export interface ShowHostConfig {
  readonly mode: HostMode;
  readonly tickHz?: number;
  readonly uiRateHz?: number;
  readonly maxBytes?: number;
}

export interface ShowHostOptions {
  readonly config: ShowHostConfig;
  readonly onCrash: (reason: string) => void;
  readonly nowNs?: () => bigint;
  readonly addonProbe?: AddonProbe;
}

export interface SnapshotWeights {
  readonly a: number;
  readonly b: number;
}

interface DeckWorld {
  state: DeckState | null;
  cursor: CursorState;
  plan: ShowPlan | null;
  generation: number;
}

type IntentResult =
  | { ok: true; [key: string]: unknown }
  | { ok: false; error: { code: string; message: string } };

const DEFAULT_TICK_HZ = 60;
const DEFAULT_UI_RATE_HZ = 30;
const DEFAULT_MAX_BYTES = 262144;
const SEEK_THRESHOLD_BEATS = 8;
const MISSED_TICK_SLACK = 1.5;

export class ShowHost {
  readonly mode: HostMode;
  readonly addonStatus: ModeStatus;

  private readonly bus: PortBus;
  private readonly worlds = new Map<number, DeckWorld>();
  private fixtures: Fixture[] = [];
  private override: OverrideKind = "none";
  private masterIntensity = 1;
  private energyTier: string | null = null;
  private activeDeck: number | null = null;
  private style: { readonly style: string; readonly palette: string } | null = null;
  private lastTrigger: "build" | "drop" | null = null;
  private lastFrames = new Map<string, Uint8Array>();
  private lastOwner: "a" | "b" | null = null;
  private lastWeights: SnapshotWeights = { a: 0, b: 0 };
  private tickCount = 0;
  private lastTickNs: bigint | null = null;
  private lastSnapshotNs = 0n;
  private lastPublishedTick = 0;
  private snapshotsPublished = 0;
  private supersededFrames = 0;
  private missedTicks = 0;
  private metricsWindowStartNs = 0n;
  private readonly tickDeltasMs: number[] = [];
  private readonly maxDeltas = 4096;
  private readonly nominalTickNs: bigint;
  private readonly snapshotIntervalNs: bigint;
  private readonly maxBytes: number;
  private readonly nowNsFn: () => bigint;
  private readonly onCrash: (reason: string) => void;
  private readonly tickHz: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private crashFired = false;

  constructor(options: ShowHostOptions) {
    this.mode = options.config.mode;
    this.tickHz = options.config.tickHz ?? DEFAULT_TICK_HZ;
    this.maxBytes = options.config.maxBytes ?? DEFAULT_MAX_BYTES;
    this.nominalTickNs = BigInt(Math.round(1e9 / this.tickHz));
    this.snapshotIntervalNs = BigInt(Math.round(1e9 / (options.config.uiRateHz ?? DEFAULT_UI_RATE_HZ)));
    this.nowNsFn = options.nowNs ?? process.hrtime.bigint;
    this.onCrash = options.onCrash;
    const probe = options.addonProbe ?? defaultAddonProbe;
    this.addonStatus = probeMode(this.mode, probe);
    this.bus = new PortBus({
      validateOutbound: (message) => {
        const parsed = hostOutboundMessageSchema.safeParse(message);
        return parsed.success ? null : parsed.error.message;
      },
      onGone: (reason) => this.handlePortGone(reason),
    });
  }

  attach(port: HostPort): void {
    this.bus.attach(port, (message) => this.handlePortMessage(message));
  }

  start(): void {
    if (!this.addonStatus.available) {
      throw new Error(
        `show host mode ${this.mode} unavailable: ${this.addonStatus.reason ?? "addon probe failed"}`,
      );
    }
    if (this.interval !== null) return;
    const periodMs = 1000 / this.tickHz;
    this.interval = setInterval(() => this.tick(this.nowNsFn()), periodMs);
  }

  stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.bus.close();
  }

  // -------------------------------------------------------------------------
  // Tick pipeline (hrtime clock)

  tick(nowNs: bigint): void {
    const last = this.lastTickNs;
    this.lastTickNs = nowNs;
    if (last !== null && nowNs >= last) {
      const deltaNs = nowNs - last;
      this.tickDeltasMs.push(Number(deltaNs) / 1e6);
      if (this.tickDeltasMs.length > this.maxDeltas) this.tickDeltasMs.shift();
      if (deltaNs > BigInt(Math.round(Number(this.nominalTickNs) * MISSED_TICK_SLACK))) this.missedTicks += 1;
    }
    this.tickCount += 1;
    this.advanceCursors(nowNs);
    const frames = this.composeFrames();
    this.lastFrames = this.applyOverrides(frames);
    if (nowNs - this.lastSnapshotNs >= this.snapshotIntervalNs) {
      this.publish(nowNs);
    }
  }

  getMetrics(): HostMetrics {
    const deltas = [...this.tickDeltasMs].sort((a, b) => a - b);
    const count = deltas.length;
    const pick = (quantile: number): number => {
      if (count === 0) return 0;
      const index = Math.min(count - 1, Math.max(0, Math.floor(quantile * (count - 1))));
      return deltas[index] ?? 0;
    };
    const elapsedNs = this.lastTickNs === null ? 0n : this.lastTickNs - this.metricsWindowStartNs;
    const missedPerHour = elapsedNs >= 1_000_000_000n ? (this.missedTicks * 3.6e12) / Number(elapsedNs) : 0;
    return {
      ticks: this.tickCount,
      snapshotsPublished: this.snapshotsPublished,
      supersededFrames: this.supersededFrames,
      intervalP50Ms: pick(0.5),
      intervalP99Ms: pick(0.99),
      intervalMaxMs: count > 0 ? (deltas[count - 1] ?? 0) : 0,
      missedTicksPerHour: missedPerHour,
    };
  }

  // -------------------------------------------------------------------------
  // Deck worlds: latest-wins ingest, estimator, cursor

  ingestDeck(deckId: number, state: DeckState): void {
    let world = this.worlds.get(deckId);
    if (world === undefined) {
      world = { state: null, cursor: { beat: 0, loopPass: 0, scratchHold: false }, plan: null, generation: 0 };
      this.worlds.set(deckId, world);
    }
    world.state = state; // latest wins, older observations are dropped
  }

  installPlan(deckId: number, generation: number, plan: ShowPlan | null): void {
    let world = this.worlds.get(deckId);
    if (world === undefined) {
      world = { state: null, cursor: { beat: 0, loopPass: 0, scratchHold: false }, plan: null, generation: 0 };
      this.worlds.set(deckId, world);
    }
    world.plan = plan;
    world.generation = generation;
  }

  installFixtures(generation: number, fixtures: Fixture[]): void {
    this.fixtures = fixtures;
    void generation;
  }

  private advanceCursors(nowNs: bigint): void {
    for (const world of this.worlds.values()) {
      if (world.state === null) continue;
      const state = world.state;
      const bpm = state.effectiveBpm ?? 120;
      const beatPerSecond = bpm / 60;
      const elapsedNs = this.lastTickNs === null ? 0n : nowNs - this.lastTickNs;
      const predicted =
        world.cursor.beat +
        (elapsedNs < 0n ? 0 : (Number(elapsedNs) / 1e9) * (state.playing ? state.playRate : 0) * beatPerSecond);
      const estimated = estimatePosition(state, nowNs) * beatPerSecond;
      const gridBeat = (seconds: number): number => seconds * beatPerSecond;
      const tracked = trackDeck(predicted, state, gridBeat, { seekThresholdBeats: SEEK_THRESHOLD_BEATS });
      if (tracked.scratchHold) continue;
      if (tracked.seeked) {
        world.cursor = { beat: tracked.beat, loopPass: 0, scratchHold: false };
        continue;
      }
      let beat = tracked.beat;
      let loopPass = 0;
      if (state.loop.active && state.loop.startSeconds !== null && state.loop.endSeconds !== null) {
        const looped = loopBeatOf(
          beat,
          state.loop.startSeconds * beatPerSecond,
          state.loop.endSeconds * beatPerSecond,
        );
        beat = looped.beat;
        loopPass = looped.pass;
      }
      world.cursor = { beat, loopPass, scratchHold: false };
    }
  }

  // -------------------------------------------------------------------------
  // Mixer + renderer + overrides

  private composeFrames(): Map<string, Uint8Array> {
    const audible = [...this.worlds.values()].filter(
      (world) => world.state !== null && audibleWeight(world.state) > 0,
    );
    if (audible.length === 0) {
      this.lastOwner = null;
      this.lastWeights = { a: 0, b: 0 };
      return new Map();
    }
    const first = audible[0]!;
    const firstMix = this.deckMixOf(first);
    let result: MixResult;
    if (audible.length === 1) {
      result = {
        owner: "a",
        cues: firstMix.cues.map((cue) => ({ ...cue, intensity: cue.intensity * audibleWeight(first.state!) })),
      };
      this.lastWeights = { a: 1, b: 0 };
    } else {
      const second = audible[1]!;
      result = mixDown(firstMix, this.deckMixOf(second));
      this.lastWeights = baseWeights(first.state!, second.state!);
    }
    this.lastOwner = result.owner;
    const frames = new Map<string, Uint8Array>();
    if (result.cues.length > 0) {
      const mixedPlan: ShowPlan = {
        schemaVersion: 1,
        plannerVersion: "mixed",
        trackId: "mixed",
        styleId: "mixed",
        seed: "mixed",
        cues: result.cues,
      };
      // Mixed cues render against the lead deck's beat; per-deck
      // progressive timing arrives with the full director (T-ARC-05).
      const rendered = renderFrame(mixedPlan, firstMix.beat, this.fixtures);
      for (const [fixtureId, bytes] of rendered) frames.set(fixtureId, bytes);
    }
    if (frames.size === 0 && this.fixtures.length > 0) {
      for (const fixture of this.fixtures) frames.set(fixture.id, new Uint8Array(fixture.cells.length * 3));
    }
    return frames;
  }

  private deckMixOf(world: DeckWorld): DeckMix {
    return {
      state: world.state!,
      beat: world.cursor.beat,
      cues: world.plan === null ? [] : evaluateCues(world.plan, world.cursor.beat),
      impactStrength: 1,
    };
  }

  private applyOverrides(frames: Map<string, Uint8Array>): Map<string, Uint8Array> {
    if (this.override === "freeze") {
      return this.lastFrames.size > 0 ? this.lastFrames : frames;
    }
    if (this.override === "blackout") return this.blankFrames(0);
    if (this.override === "white") return this.blankFrames(Math.round(255 * this.masterIntensity));
    const factor = this.masterIntensity * (this.override === "force-low" ? 0.25 : 1);
    if (factor === 1) return frames;
    const scaled = new Map<string, Uint8Array>();
    for (const [fixtureId, bytes] of frames) scaled.set(fixtureId, scaleBytes(bytes, factor));
    return scaled;
  }

  private blankFrames(value: number): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    for (const fixture of this.fixtures) {
      out.set(fixture.id, new Uint8Array(fixture.cells.length * 3).fill(value));
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Snapshot publisher (latest wins at runtime.snapshot.uiRateHz)

  private publish(nowNs: bigint): void {
    const snapshot = this.buildSnapshot(nowNs);
    const bytes = Buffer.byteLength(JSON.stringify(snapshot));
    if (bytes > this.maxBytes) {
      throw new Error(`snapshot is ${bytes} bytes, over runtime.snapshot.maxBytes ${this.maxBytes}`);
    }
    this.bus.send({ type: "snapshot", snapshot });
    this.bus.send({ type: "metrics", metrics: this.getMetrics() });
    this.supersededFrames += Math.max(0, this.tickCount - this.lastPublishedTick - 1);
    this.lastPublishedTick = this.tickCount;
    this.snapshotsPublished += 1;
    this.lastSnapshotNs = nowNs;
  }

  private buildSnapshot(nowNs: bigint): HostSnapshot {
    const decks: DeckSnapshot[] = [];
    for (const world of this.worlds.values()) {
      if (world.state === null) continue;
      const state = world.state;
      const ageMs = nowNs >= state.receivedAtNs ? Number(nowNs - state.receivedAtNs) / 1e6 : 0;
      decks.push({
        deckId: state.deckId,
        beat: world.cursor.beat,
        loopPass: world.cursor.loopPass,
        playing: state.playing,
        playRate: state.playRate,
        effectiveBpm: state.effectiveBpm,
        override: this.override,
        clockHealth: clockHealth(ageMs),
      });
    }
    const cells: CellSnapshot[] = [];
    for (const fixture of this.fixtures) {
      const bytes = this.lastFrames.get(fixture.id);
      if (bytes === undefined) continue;
      for (let i = 0; i < fixture.cells.length; i += 1) {
        const offset = i * 3;
        const color = [bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0] as [
          number,
          number,
          number,
        ];
        cells.push({ fixtureId: fixture.id, cellIndex: fixture.cells[i]!.index, color });
      }
    }
    return {
      tick: this.tickCount,
      tMs: Number(nowNs) / 1e6,
      mode: this.mode,
      decks,
      owner: this.lastOwner,
      weights: this.lastWeights,
      cells,
    };
  }

  // -------------------------------------------------------------------------
  // Port protocol handling

  private handlePortMessage(message: unknown): void {
    const parsed = hostInboundMessageSchema.safeParse(message);
    if (!parsed.success) {
      this.invalidInbound(parsed.error.issues[0]?.message ?? "schema violation");
      return;
    }
    const inbound = parsed.data;
    switch (inbound.type) {
      case "deck": {
        this.ingestDeck(inbound.deckId, { ...inbound.state, receivedAtNs: BigInt(inbound.state.receivedAtNs) });
        break;
      }
      case "plan": {
        this.installPlan(inbound.deckId, inbound.generation, inbound.plan);
        break;
      }
      case "fixtures": {
        this.installFixtures(inbound.generation, inbound.fixtures);
        break;
      }
      case "intent": {
        const response = this.handleIntent(inbound.channel, inbound.request);
        this.sendResponse(inbound.channel, response);
        break;
      }
      case "close": {
        this.stop();
        break;
      }
    }
  }

  private invalidInbound(detail: string): void {
    this.bus.send({ type: "error", error: { code: "E_BAD_MESSAGE", message: `inbound message: ${detail}` } });
  }

  private sendResponse(channel: Channel, result: IntentResult): void {
    const schema = channels[channel].response as unknown as z.ZodType<unknown>;
    const parsed = schema.safeParse(result);
    if (!parsed.success) {
      throw new Error(`show host response for ${channel} failed its schema: ${parsed.error.message}`);
    }
    this.bus.send({ type: "response", channel, response: parsed.data });
  }

  private handleIntent(channel: Channel, request: unknown): IntentResult {
    const schema = channels[channel].request as unknown as z.ZodType<unknown>;
    const parsed = schema.safeParse(request);
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: "E_BAD_REQUEST", message: `${channel}: ${parsed.error.issues[0]?.message ?? "invalid"}` },
      };
    }
    const data = parsed.data as Record<string, unknown>;
    let response: Record<string, unknown>;
    switch (channel) {
      case "master/blackout": {
        this.override = "blackout";
        response = { blackout: true };
        break;
      }
      case "master/full": {
        this.override = "white";
        response = { full: true };
        break;
      }
      case "master/freeze": {
        const frozen = data.frozen as boolean;
        if (frozen) this.override = "freeze";
        else if (this.override === "freeze") this.override = "none";
        response = { frozen: this.override === "freeze" };
        break;
      }
      case "master/intensity": {
        this.masterIntensity = data.value as number;
        response = { value: this.masterIntensity };
        break;
      }
      case "master/resume": {
        this.override = "none";
        const at = data.at as ResumeAt;
        const lead = this.worlds.values().next().value;
        if (lead !== undefined && lead.state !== null) {
          lead.cursor = { ...lead.cursor, beat: quantizeResume(lead.cursor.beat, at) };
        }
        response = { at };
        break;
      }
      case "show/energy": {
        this.energyTier = data.tier as string;
        response = { tier: this.energyTier };
        break;
      }
      case "show/trigger-build": {
        this.lastTrigger = "build";
        response = { triggered: true };
        break;
      }
      case "show/trigger-drop": {
        this.lastTrigger = "drop";
        response = { triggered: true };
        break;
      }
      case "show/style": {
        this.style = { style: data.style as string, palette: data.palette as string };
        response = { style: this.style.style };
        break;
      }
      case "show/state": {
        this.activeDeck = data.deck as number;
        response = { deck: this.activeDeck };
        break;
      }
      default: {
        return {
          ok: false,
          error: { code: "E_MAIN_CHANNEL", message: `channel ${channel} is handled in main, not in the show host` },
        };
      }
    }
    return { ok: true, ...response };
  }

  private handlePortGone(reason: string): void {
    if (this.crashFired) return;
    this.crashFired = true;
    this.onCrash(reason);
  }
}

// ---------------------------------------------------------------------------
// Main-side launcher (MessagePort chain from main)

export interface HostHandle {
  readonly mode: HostMode;
  readonly port: MessagePort;
  readonly status: ModeStatus;
  stop(): void;
}

// One typed MessagePort pair: `port` stays in main (forwards snapshots and
// metrics to the renderer, receives deck/plan/fixtures/intent messages), the
// other end drives the show host pipeline. Throws when the mode's native
// addons cannot load; no silent fallback to another mode.
export interface StartHostOptions {
  readonly probe?: AddonProbe;
  readonly onCrash?: (reason: string) => void;
  readonly tickHz?: number;
  readonly uiRateHz?: number;
  readonly maxBytes?: number;
}

export function startHost(mode: HostMode, probeOrOptions?: AddonProbe | StartHostOptions): HostHandle {
  const options: StartHostOptions =
    typeof probeOrOptions === "function"
      ? { probe: probeOrOptions as AddonProbe }
      : (probeOrOptions ?? {});
  const probe = options.probe ?? defaultAddonProbe;
  const status = probeMode(mode, probe);
  if (!status.available) {
    throw new Error(`show host mode ${mode} unavailable: ${status.reason ?? "addon probe failed"}`);
  }
  const channel = new MessageChannel();
  const hostConfig: { mode: HostMode; tickHz?: number; uiRateHz?: number; maxBytes?: number } = { mode };
  if (options.tickHz !== undefined) hostConfig.tickHz = options.tickHz;
  if (options.uiRateHz !== undefined) hostConfig.uiRateHz = options.uiRateHz;
  if (options.maxBytes !== undefined) hostConfig.maxBytes = options.maxBytes;
  const onCrash = options.onCrash ?? (() => undefined);
  const host = new ShowHost({
    config: hostConfig,
    onCrash,
    addonProbe: probe,
  });
  host.attach(wrapMessagePort(channel.port2, true));
  host.start();
  return {
    mode,
    port: channel.port1,
    status,
    stop: () => host.stop(),
  };
}

// ---------------------------------------------------------------------------
// Shared helpers

function scaleBytes(bytes: Uint8Array, factor: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    out[i] = Math.round(Math.min(255, (bytes[i] ?? 0) * factor));
  }
  return out;
}

function loopBeatOf(beat: number, loopStart: number, loopEnd: number): { beat: number; pass: number } {
  const length = loopEnd - loopStart;
  if (!(length > 0) || beat < loopStart) return { beat, pass: 0 };
  const pass = Math.floor((beat - loopStart) / length);
  return { beat: loopStart + ((beat - loopStart) % length), pass };
}
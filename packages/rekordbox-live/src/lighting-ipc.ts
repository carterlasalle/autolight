// Lighting IPC provider: capture tooling support, fixtures, decoder, replay
// (T-LIVE-09, F-LIVE-01, F-LIVE-02, F-LIVE-15, spec 9).
//
// Honest state of the world: the real SoundSwitch Lighting transport is
// undocumented until the owner runs HW-RB-LIGHT-01 (Rekordbox 7.2.19+ with
// SoundSwitch 2.11+ installed, spec 9.1) and commits real captures. No decoder
// is claimed and no protocol is guessed before that.
//
// What this module provides today, verified against a fake target process:
// - surface inventory collection and validation (spec 9.2);
// - capture matrix planning: the 27 actions times 7 conditions of spec 9.3;
// - fixture envelope validation plus replay through the real frame decoder
//   at 1x, 2x, 10x and step (spec 9.4, 128, T-QA-03 harness semantics);
// - a frame codec for the capture container format used by the matrix runner:
//   framed JSON events over length-prefixed transport frames. This is OUR
//   documented capture container, not a guess at SoundSwitch bytes. When real
//   captures land, a SoundSwitch-specific decoder plugs into `decodeFrames`
//   behind a versioned decoder id and the same replay path validates it.
// - the `LightingIpcProvider` selectable under the DS-01 decision switch,
//   which replays committed fixtures through that decoder and reports its
//   capability honestly (`MISSING` until real captures land).
import { z } from "zod";
import {
  DeckGenerationMapper,
  ProviderBase,
  type ClockFn,
  type ProviderCapabilities,
  type ProviderDeckState,
  type ProviderId,
  type QualityLabel,
} from "./providers.js";

export const LIGHTING_PROVIDER_ID = "lighting-ipc" as const satisfies ProviderId;

// Capture container framing. A capture is a byte stream of frames:
// u32be length N, then N bytes of UTF-8 JSON for one lighting event.
// The runner writes base64 of this stream into the fixture `capture` field.
// Unknown JSON fields are retained under raw, never dropped (spec 9.5).
export const LIGHTING_CONTAINER_DECODER_V1 = "lighting-container/v1";

const lightingEventSchema = z.object({
  deck: z.number().int().min(1).max(4),
  playing: z.boolean().optional(),
  playheadSeconds: z.number().optional(),
  playRate: z.number().optional(),
  effectiveBpm: z.number().nullable().optional(),
  trackId: z.string().optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  loopActive: z.boolean().optional(),
  loopBeatLength: z.number().nullable().optional(),
  pitchPercent: z.number().nullable().optional(),
  sync: z.boolean().nullable().optional(),
  master: z.boolean().nullable().optional(),
  channelFader: z.number().nullable().optional(),
  crossfader: z.number().nullable().optional(),
  hotCue: z.number().int().nullable().optional(),
  rollActive: z.boolean().optional(),
  rollBeats: z.number().nullable().optional(),
}).catchall(z.unknown());

export type LightingEvent = z.infer<typeof lightingEventSchema>;

export interface LightingFrame {
  readonly event: LightingEvent;
  readonly raw: Record<string, unknown>;
}

export interface LightingDecodeResult {
  readonly frames: LightingFrame[];
  readonly malformed: string[];
}

export function encodeLightingCapture(events: readonly LightingEvent[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const encoder = new TextEncoder();
  for (const event of events) {
    const body = encoder.encode(JSON.stringify(event));
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, body.length, false);
    const merged = new Uint8Array(4 + body.length);
    merged.set(header, 0);
    merged.set(body, 4);
    parts.push(merged);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function encodeLightingCaptureBase64(events: readonly LightingEvent[]): string {
  return Buffer.from(encodeLightingCapture(events)).toString("base64");
}

export function decodeLightingCapture(bytes: Uint8Array): LightingDecodeResult {
  const frames: LightingFrame[] = [];
  const malformed: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) {
      malformed.push(`truncated frame header at ${offset}`);
      break;
    }
    const length = view.getUint32(offset, false);
    offset += 4;
    if (length > 4 * 1024 * 1024) {
      malformed.push(`frame too large (${length} bytes at ${offset - 4})`);
      break;
    }
    if (offset + length > bytes.length) {
      malformed.push(`truncated frame body at ${offset} (need ${length})`);
      break;
    }
    const body = bytes.slice(offset, offset + length);
    offset += length;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
      const event = lightingEventSchema.parse(parsed);
      const known: Record<string, true> = {
        deck: true, playing: true, playheadSeconds: true, playRate: true, effectiveBpm: true,
        trackId: true, title: true, artist: true, loopActive: true, loopBeatLength: true,
        pitchPercent: true, sync: true, master: true, channelFader: true, crossfader: true,
        hotCue: true, rollActive: true, rollBeats: true,
      };
      const raw: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!known[key]) raw[key] = value;
      }
      raw["provider"] = LIGHTING_PROVIDER_ID;
      frames.push({ event, raw });
    } catch (err) {
      malformed.push(`bad frame at ${offset - length}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { frames, malformed };
}

export function decodeLightingCaptureBase64(capture: string): LightingDecodeResult {
  if (!capture || capture.length === 0) return { frames: [], malformed: ["empty capture"] };
  if (capture.startsWith("handwritten-synthetic:")) {
    return { frames: [], malformed: ["handwritten-synthetic capture marker, no bytes to decode"] };
  }
  try {
    return decodeLightingCapture(new Uint8Array(Buffer.from(capture, "base64")));
  } catch (err) {
    return { frames: [], malformed: [`capture is not base64: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

// Capture matrix (spec 9.3): 27 actions times 7 conditions, one at a time
// from idle. The matrix runner walks this list; each cell becomes one fixture
// in the spec 9.4 layout.
export const LIGHTING_MATRIX_ACTIONS = [
  "launch", "launch-soundswitch", "enable-lighting", "load-deck-1", "load-deck-2",
  "play", "pause", "cue", "seek", "jog-fwd", "jog-back", "scratch",
  "pitch-plus-1", "pitch-minus-1", "sync-on", "sync-off", "hotcue", "autoloop",
  "manual-loop", "loop-resize", "loop-roll", "loop-exit", "chfader",
  "crossfader", "master-change", "unload", "replace",
] as const;

export const LIGHTING_MATRIX_CONDITIONS = [
  "one-deck", "two-decks", "both-playing", "crossfader-center",
  "crossfader-extremes", "tempo-mismatch", "tempo-sync",
] as const;

export type LightingMatrixAction = (typeof LIGHTING_MATRIX_ACTIONS)[number];
export type LightingMatrixCondition = (typeof LIGHTING_MATRIX_CONDITIONS)[number];

export interface LightingMatrixCell {
  readonly action: LightingMatrixAction;
  readonly condition: LightingMatrixCondition;
}

export function lightingMatrixCells(): LightingMatrixCell[] {
  const out: LightingMatrixCell[] = [];
  for (const action of LIGHTING_MATRIX_ACTIONS) {
    for (const condition of LIGHTING_MATRIX_CONDITIONS) {
      out.push({ action, condition });
    }
  }
  return out;
}

export function lightingFixturePath(version: string, platform: string, cell: LightingMatrixCell): string {
  return `protocol-fixtures/rekordbox/${version}/${platform}/${cell.action}-${cell.condition}/capture.json`;
}

// Surface inventory (spec 9.2). The owner scripts collect raw tool output;
// this module validates and normalizes it into one document per OS so the
// runner can require every surface before a capture counts.
export const LIGHTING_SURFACES = [
  "tcp", "udp", "mdns", "unix-sockets", "websockets", "localhost-http",
  "ipc-pipes", "file-descriptors", "rekordbox-logs", "soundswitch-logs",
] as const;

export type LightingSurface = (typeof LIGHTING_SURFACES)[number];

export interface LightingSurfaceInventory {
  readonly rekordboxVersion: string;
  readonly platform: "macos" | "windows";
  readonly surfaces: Partial<Record<LightingSurface, { observed: boolean; detail: string }>>;
}

export function validateSurfaceInventory(inventory: LightingSurfaceInventory): string[] {
  const missing: string[] = [];
  for (const surface of LIGHTING_SURFACES) {
    const entry = inventory.surfaces[surface];
    if (!entry || !entry.observed) missing.push(surface);
  }
  return missing;
}

export interface LightingFixture {
  readonly rekordboxVersion: string;
  readonly platform: "macos" | "windows";
  readonly action: string;
  readonly condition: string;
  readonly capture: string;
  readonly decoder: string;
  readonly expectedBy: string;
}

const lightingFixtureSchema = z.object({
  rekordboxVersion: z.string().min(1),
  platform: z.enum(["macos", "windows"]),
  action: z.string().min(1),
  condition: z.string().min(1),
  capture: z.string().min(1, "empty capture: record the raw transport bytes"),
  decoder: z.string().min(1),
  expectedBy: z.string().min(1),
});
export function parseLightingFixture(raw: unknown): LightingFixture {
  return lightingFixtureSchema.parse(raw);
}

export function lintLightingFixture(raw: unknown): string[] {
  const failures: string[] = [];
  try {
    const fixture = parseLightingFixture(raw);
    if (fixture.capture.startsWith("handwritten-synthetic:")) {
      failures.push("capture is a synthetic marker, not transport bytes");
    }
    if (/decoder/i.test(fixture.expectedBy)) {
      failures.push("expectedBy names the decoder, not the human author");
    }
  } catch (err) {
    failures.push(err instanceof Error ? err.message : String(err));
  }
  return failures;
}

export interface LightingReplayOptions {
  rate?: number;
  stepMs?: number;
}

// Replay through the real decoder at 1x, 2x, 10x and step (spec 128): the raw
// capture bytes are decoded, mapped to deck states on a virtual clock, and
// returned in capture order. Real decoders run here; invented frames prove
// nothing, so a capture that does not decode yields no states.
export function replayLightingCapture(
  fixture: LightingFixture,
  mapper: DeckGenerationMapper,
  opts: LightingReplayOptions = {},
  now: ClockFn | null = null,
): { states: ProviderDeckState[]; malformed: string[] } {
  const rate = opts.rate ?? 1;
  const stepMs = opts.stepMs ?? 100;
  const { frames, malformed } = decodeLightingCaptureBase64(fixture.capture);
  const baseNs = 1_000_000_000n;
  const clock = now ?? (() => baseNs);
  const states = frames.map((frame, index) => {
    const atNs = baseNs + BigInt(Math.round((index * stepMs * 1_000_000) / rate));
    return frameToState(frame, mapper, atNs, clock);
  });
  return { states, malformed };
}

function frameToState(
  frame: LightingFrame,
  mapper: DeckGenerationMapper,
  atNs: bigint,
  clock: ClockFn,
): ProviderDeckState {
  void clock;
  const event = frame.event;
  const state = mapper.update(LIGHTING_PROVIDER_ID, {
    deckId: event.deck,
    atNs,
    playing: event.playing ?? false,
    playheadSeconds: event.playheadSeconds ?? 0,
    playRate: event.playRate ?? 1,
    effectiveBpm: event.effectiveBpm ?? null,
    ...(event.trackId !== undefined || event.title !== undefined
      ? {
        track: {
          id: event.trackId ?? `lighting:${event.title ?? "unknown"}`,
          ...(event.title ? { title: event.title } : {}),
          ...(event.artist ? { artist: event.artist } : {}),
        },
      }
      : {}),
    beat: null,
    beatInBar: null,
    pitchPercent: event.pitchPercent ?? null,
    sync: event.sync ?? null,
    loopRoll: event.loopActive !== undefined || event.rollActive !== undefined
      ? {
        active: (event.loopActive ?? false) || (event.rollActive ?? false),
        beatLength: event.loopBeatLength ?? event.rollBeats ?? null,
      }
      : null,
    hotCue: event.hotCue !== undefined && event.hotCue !== null
      ? { number: event.hotCue, atNs }
      : null,
    master: event.master ?? null,
    channelFader: event.channelFader ?? null,
    crossfader: event.crossfader ?? null,
    quality: lightingQuality(),
  });
  return { ...state, raw: frame.raw };
}

function lightingQuality(): Partial<Record<keyof ProviderDeckState, QualityLabel>> {
  return {
    playheadSeconds: "exact",
    playing: "exact",
    effectiveBpm: "exact",
    master: "exact",
    sync: "exact",
  };
}

export interface LightingProviderOptions {
  now?: ClockFn;
  fixtures?: readonly LightingFixture[];
}

export type LightingCapability = "MISSING" | "READY";

// The runtime provider. Until real SoundSwitch captures land, the capability
// is MISSING and the provider reports unavailable with the owner remedy
// (spec 120 item 15: the app runs without SoundSwitch). Fixture replay drives
// the decoder path so the replay tests exercise real code.
export class LightingIpcProvider extends ProviderBase {
  private readonly mapper = new DeckGenerationMapper();
  private readonly capabilities: ProviderCapabilities = {
    master: true, loop: true, pitch: true, sync: true, hotCue: true, roll: true,
  };
  private readonly fixtures: readonly LightingFixture[];

  constructor(opts: LightingProviderOptions = {}) {
    super(LIGHTING_PROVIDER_ID, "rekordbox", opts.now);
    this.fixtures = opts.fixtures ?? [];
  }

  capability(): LightingCapability {
    return this.fixtures.length > 0 ? "READY" : "MISSING";
  }

  protected async onStart(): Promise<void> {
    if (this.fixtures.length === 0) {
      this.setStatus({
        state: "unavailable",
        reason: "no Lighting IPC captures committed (owner runbook HW-RB-LIGHT-01 not run)",
        remedy: "run the capture matrix with Rekordbox 7.2.19+ and SoundSwitch 2.11+, or use another live source",
      });
      return;
    }
    this.setStatus({ state: "starting" });
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  getDecks(): readonly ProviderDeckState[] {
    return this.replayed;
  }

  private readonly replayed: ProviderDeckState[] = [];

  replayAll(opts: LightingReplayOptions = {}): { states: ProviderDeckState[]; malformed: string[] } {
    const states: ProviderDeckState[] = [];
    const malformed: string[] = [];
    for (const fixture of this.fixtures) {
      const result = replayLightingCapture(fixture, this.mapper, opts, this.now);
      malformed.push(...result.malformed.map((m) => `${fixture.action}: ${m}`));
      states.push(...result.states);
    }
    this.replayed.length = 0;
    this.replayed.push(...states);
    for (const state of states) this.emit(state);
    if (states.length > 0 && malformed.length === 0) {
      this.setStatus({ state: "live", updateHz: 0, ageMs: 0 });
    } else if (states.length === 0 && malformed.length > 0) {
      this.markRejected(malformed[0] ?? "lighting capture did not decode");
    }
    return { states, malformed };
  }
  // Direct event ingest for tests and the contract suite: encodes the event
  // through the real container codec, then decodes and maps it, so the
  // suite exercises the same bytes-to-state path as fixture replay.
  ingestEvent(event: LightingEvent, atNs?: bigint): ProviderDeckState | null {
    const at = atNs ?? this.now();
    const decoded = decodeLightingCapture(encodeLightingCapture([event]));
    const frame = decoded.frames[0];
    if (decoded.malformed.length > 0 || !frame) {
      this.markRejected(decoded.malformed[0] ?? "lighting event did not encode");
      return null;
    }
    const state = frameToState(frame, this.mapper, at, this.now);
    this.replayed.push(state);
    this.emit(state);
    this.setStatus({ state: "live", updateHz: 0, ageMs: 0 });
    return state;
  }

  ingestBytes(bytes: Uint8Array, atNs?: bigint): void {
    const at = atNs ?? this.now();
    const decoded = decodeLightingCapture(bytes);
    if (decoded.malformed.length > 0 || decoded.frames.length === 0) {
      this.markRejected(decoded.malformed[0] ?? "lighting bytes did not decode");
      return;
    }
    for (const frame of decoded.frames) {
      const state = frameToState(frame, this.mapper, at, this.now);
      this.replayed.push(state);
      this.emit(state);
    }
    this.setStatus({ state: "live", updateHz: 0, ageMs: 0 });
  }
}

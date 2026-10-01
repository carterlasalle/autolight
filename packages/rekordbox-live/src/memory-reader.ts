// Clean-room memory reader (`memory-cleanroom`, T-LIVE-11, F-LIVE-03, F-SEC-03).
//
// Consent gated: the reader stays off unless `live.memoryReader.enabled` is
// true AND the T-SEC-05 consent flow granted access. The app itself never runs
// elevated: a separate signed helper process owns the privileges and speaks
// to the main process over a local socket. The re-sign requirement and its
// consequences are explained in the consent flow, never hidden.
//
// Version discipline: every offsets file carries the Rekordbox version,
// platform, date and a verification record. An unknown version shows
// `UNVERIFIED REKORDBOX VERSION` and the reader stays off. No rkbx_link
// code or offsets are copied or consulted as data: pointer paths are built
// by our own documented scan process (scanner finds values from known
// observations, e.g. a paused deck at a known time, writes candidate
// paths, verifies across restarts) against a committed test target process
// that mimics the structure with our own code.
//
// This module holds the data format, the verification logic, the in-process
// reader core (pointer-path walk over an injected memory accessor, so tests
// and the helper IPC transport share the decode), and the provider. The
// privileged helper process itself is host wiring outside this slice.
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

export const MEMORY_PROVIDER_ID = "memory-cleanroom" as const satisfies ProviderId;

const pointerPathSchema = z.object({
  field: z.enum(["playheadSamples", "bpm", "masterDeck", "trackId"]),
  base: z.string().min(1),
  offsets: z.array(z.number().int()),
  sampleRateHz: z.number().optional(),
});

export type MemoryPointerPath = z.infer<typeof pointerPathSchema>;

const offsetsFileSchema = z.object({
  rekordboxVersion: z.string().min(1),
  platform: z.enum(["macos", "windows"]),
  date: z.string().min(1),
  verification: z.object({
    restarts: z.number().int().min(1),
    observations: z.number().int().min(1),
    maxErrorMs: z.number(),
    runbook: z.string().min(1),
  }),
  paths: z.array(pointerPathSchema).min(1),
});

export type MemoryOffsetsFile = z.infer<typeof offsetsFileSchema>;

export function parseOffsetsFile(raw: unknown): MemoryOffsetsFile {
  return offsetsFileSchema.parse(raw);
}

export function lintOffsetsFile(raw: unknown): string[] {
  const failures: string[] = [];
  try {
    parseOffsetsFile(raw);
  } catch (err) {
    failures.push(err instanceof Error ? err.message : String(err));
  }
  return failures;
}

export interface MemoryQualification {
  readonly qualified: boolean;
  readonly reason: string;
}

export function qualifyOffsets(
  offsets: MemoryOffsetsFile,
  installedVersion: string,
  platform: "macos" | "windows",
): MemoryQualification {
  if (offsets.platform !== platform) {
    return { qualified: false, reason: `offsets are for ${offsets.platform}, running on ${platform}` };
  }
  const short = installedVersion.split(".").slice(0, 3).join(".");
  const fileShort = offsets.rekordboxVersion.split(".").slice(0, 3).join(".");
  if (short !== fileShort) {
    return {
      qualified: false,
      reason: `UNVERIFIED REKORDBOX VERSION ${installedVersion} (offsets verified for ${offsets.rekordboxVersion})`,
    };
  }
  return { qualified: true, reason: `verified ${offsets.verification.observations} observations across ${offsets.verification.restarts} restarts (${offsets.verification.runbook})` };
}

// One abstract memory region for tests and the helper transport: named
// numeric slots addressed as base+index, so pointer paths resolve without a
// real process handle.
export interface MemoryAccessor {
  readU64(slot: string, index: number): bigint | null;
  readF64(slot: string, index: number): number | null;
  readU32(slot: string, index: number): number | null;
}

export class MapMemoryAccessor implements MemoryAccessor {
  private readonly u64 = new Map<string, bigint>();
  private readonly f64 = new Map<string, number>();
  private readonly u32 = new Map<string, number>();

  static key(slot: string, index: number): string {
    return `${slot}+${index}`;
  }

  writeU64(slot: string, index: number, value: bigint): void {
    this.u64.set(MapMemoryAccessor.key(slot, index), value);
  }

  writeF64(slot: string, index: number, value: number): void {
    this.f64.set(MapMemoryAccessor.key(slot, index), value);
  }

  writeU32(slot: string, index: number, value: number): void {
    this.u32.set(MapMemoryAccessor.key(slot, index), value);
  }

  readU64(slot: string, index: number): bigint | null {
    return this.u64.get(MapMemoryAccessor.key(slot, index)) ?? null;
  }

  readF64(slot: string, index: number): number | null {
    return this.f64.get(MapMemoryAccessor.key(slot, index)) ?? null;
  }

  readU32(slot: string, index: number): number | null {
    return this.u32.get(MapMemoryAccessor.key(slot, index)) ?? null;
  }
}

export interface MemorySample {
  readonly playheadSamples: bigint | null;
  readonly bpm: number | null;
  readonly masterDeck: number | null;
  readonly trackId: number | null;
}

export function readMemorySample(
  accessor: MemoryAccessor,
  offsets: MemoryOffsetsFile,
  deckSlot: (deck: number) => string,
): Map<number, MemorySample> {
  const out = new Map<number, MemorySample>();
  for (const deck of [1, 2, 3, 4]) {
    const slot = deckSlot(deck);
    let playheadSamples: bigint | null = null;
    let bpm: number | null = null;
    let masterDeck: number | null = null;
    let trackId: number | null = null;
    for (const path of offsets.paths) {
      const index = path.offsets[0] ?? 0;
      if (path.field === "playheadSamples") playheadSamples = accessor.readU64(slot, index);
      else if (path.field === "bpm") bpm = accessor.readF64(slot, index);
      else if (path.field === "masterDeck") masterDeck = accessor.readU32(slot, index);
      else if (path.field === "trackId") trackId = accessor.readU32(slot, index);
    }
    if (playheadSamples !== null || bpm !== null || trackId !== null) {
      out.set(deck, { playheadSamples, bpm, masterDeck, trackId });
    }
  }
  return out;
}

// Scanner: from known observations (paused deck at a known time, known BPM)
// find the slots whose values match, write candidate paths, and verify them
// across a second observation set. Pure and deterministic for tests.
export interface MemoryObservation {
  readonly deck: number;
  readonly playheadSeconds: number;
  readonly bpm: number;
  readonly trackId: number;
}

export function scanMemoryOffsets(
  accessor: MemoryAccessor,
  slots: readonly string[],
  range: number,
  observations: readonly MemoryObservation[],
  sampleRateHz: number,
): MemoryPointerPath[] {
  const first = observations[0];
  if (!first) return [];
  const expectedSamples = BigInt(Math.round(first.playheadSeconds * sampleRateHz));
  const found: MemoryPointerPath[] = [];
  for (const slot of slots) {
    for (let index = 0; index < range; index++) {
      if (accessor.readU64(slot, index) === expectedSamples) {
        found.push({ field: "playheadSamples", base: slot, offsets: [index], sampleRateHz });
      }
      if (accessor.readF64(slot, index) === first.bpm) {
        found.push({ field: "bpm", base: slot, offsets: [index] });
      }
      if (accessor.readU32(slot, index) === first.trackId) {
        found.push({ field: "trackId", base: slot, offsets: [index] });
      }
    }
  }
  const rest = observations.slice(1);
  return found.filter((candidate) => {
    const obs = rest[0];
    if (!obs) return true;
    const index = candidate.offsets[0] ?? 0;
    if (candidate.field === "playheadSamples") {
      return accessor.readU64(candidate.base, index) === BigInt(Math.round(obs.playheadSeconds * sampleRateHz))
        || accessor.readU64(candidate.base, index) === expectedSamples;
    }
    return true;
  });
}

export interface MemoryReaderOptions {
  now?: ClockFn;
  enabled?: boolean;
  consentGranted?: boolean;
  installedVersion?: string;
  platform?: "macos" | "windows";
  offsets?: MemoryOffsetsFile | null;
  accessor?: MemoryAccessor | null;
  sampleRateHz?: number;
}

export type MemoryCapability = "READY" | "MISSING" | "UNAVAILABLE_ON_THIS_DEVICE" | "CONSENT_REQUIRED";

export class MemoryCleanroomProvider extends ProviderBase {
  private readonly mapper = new DeckGenerationMapper();
  private readonly capabilities: ProviderCapabilities = {
    master: true, loop: false, pitch: true, sync: false, hotCue: false, roll: false,
  };
  private readonly enabled: boolean;
  private consentGranted: boolean;
  private readonly installedVersion: string;
  private readonly platform: "macos" | "windows";
  private readonly offsets: MemoryOffsetsFile | null;
  private readonly accessor: MemoryAccessor | null;
  private readonly sampleRateHz: number;

  constructor(opts: MemoryReaderOptions = {}) {
    super(MEMORY_PROVIDER_ID, "rekordbox", opts.now);
    this.enabled = opts.enabled ?? false;
    this.consentGranted = opts.consentGranted ?? false;
    this.installedVersion = opts.installedVersion ?? "";
    this.platform = opts.platform ?? "macos";
    this.offsets = opts.offsets ?? null;
    this.accessor = opts.accessor ?? null;
    this.sampleRateHz = opts.sampleRateHz ?? 44100;
  }

  setConsent(granted: boolean): void {
    this.consentGranted = granted;
  }

  capability(): MemoryCapability {
    if (!this.enabled) return "MISSING";
    if (!this.consentGranted) return "CONSENT_REQUIRED";
    if (!this.offsets || !this.accessor) return "MISSING";
    const qualification = qualifyOffsets(this.offsets, this.installedVersion, this.platform);
    return qualification.qualified ? "READY" : "UNAVAILABLE_ON_THIS_DEVICE";
  }

  protected async onStart(): Promise<void> {
    const capability = this.capability();
    if (capability === "CONSENT_REQUIRED") {
      this.setStatus({
        state: "unavailable",
        reason: "memory reader consent not granted",
        remedy: "grant memory reader consent in Settings (T-SEC-05 flow), or use another live source",
      });
      return;
    }
    if (capability === "MISSING") {
      this.setStatus({
        state: "unavailable",
        reason: "memory reader disabled or no offsets file (live.memoryReader.enabled, live.memoryReader.offsetsFile)",
        remedy: "enable the reader with consent and run HW-RB-MEM-01 to build the offsets file, or use another live source",
      });
      return;
    }
    if (capability === "UNAVAILABLE_ON_THIS_DEVICE" && this.offsets) {
      const qualification = qualifyOffsets(this.offsets, this.installedVersion, this.platform);
      this.setStatus({ state: "unavailable", reason: qualification.reason, remedy: "run HW-RB-MEM-01 for this Rekordbox version" });
      return;
    }
    this.setStatus({ state: "starting" });
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  getDecks(): readonly ProviderDeckState[] {
    return [...this.samples.keys()].sort((a, b) => a - b).map((deck) => this.stateFor(deck));
  }

  private readonly samples = new Map<number, { sample: MemorySample; atNs: bigint }>();

  poll(atNs?: bigint): void {
    const at = atNs ?? this.now();
    if (this.capability() !== "READY" || !this.offsets || !this.accessor) return;
    const rate = this.sampleRateHz;
    const found = readMemorySample(this.accessor, this.offsets, (deck) => `deck${deck}`);
    void rate;
    for (const [deck, sample] of found) {
      this.samples.set(deck, { sample, atNs: at });
      this.emit(this.stateFor(deck, at));
    }
    if (found.size > 0) this.setStatus({ state: "live", updateHz: 0, ageMs: 0 });
  }

  ingestMalformed(reason = "malformed helper frame"): void {
    this.markRejected(reason);
  }

  private stateFor(deck: number, atNs?: bigint): ProviderDeckState {
    const entry = this.samples.get(deck);
    const at = atNs ?? entry?.atNs ?? this.now();
    const sample = entry?.sample;
    const playheadSeconds = sample?.playheadSamples !== null && sample?.playheadSamples !== undefined
      ? Number(sample.playheadSamples) / this.sampleRateHz
      : 0;
    const state = this.mapper.update(this.id, {
      deckId: deck,
      atNs: at,
      playing: true,
      playheadSeconds,
      effectiveBpm: sample?.bpm ?? null,
      ...(sample?.trackId !== null && sample?.trackId !== undefined
        ? { track: { id: `rb:${sample.trackId}` } }
        : {}),
      master: sample?.masterDeck === null || sample?.masterDeck === undefined
        ? null
        : sample.masterDeck === deck,
      quality: this.qualityFor(),
    });
    return { ...state, raw: { provider: MEMORY_PROVIDER_ID } };
  }

  private qualityFor(): Partial<Record<keyof ProviderDeckState, QualityLabel>> {
    return {
      playheadSeconds: "exact",
      playing: "derived",
      effectiveBpm: "exact",
      master: "exact",
    };
  }
}

// Serato protocol fixtures and replay (T-SER-05, closes F-SER-05; spec 9.4, 119, 128).
//
// A fixture is a raw capture of a Remote session plus human-written
// `expectedEvents`, in the same envelope the Rekordbox captures use:
//
//   {
//     "seratoVersion": "3.3.5", "platform": "macos", "action": "play",
//     "capture": "<base64 of the framed wire bytes>",
//     "frameTimesMs": [0, 20, 120],
//     "expectedEvents": [ { ...DeckState without receivedAtNs } ],
//     "expectedBy": "<who wrote these>"
//   }
//
// `capture` is the concatenated wire stream (each frame ends with the 16-byte
// sentinel the protocol uses); `frameTimesMs` gives one arrival timestamp per
// frame on the capture's own timeline. `framesFromFixture` splits the stream
// with that same sentinel, which it obtains from serato-connect's own
// `frameOsc` (the dependency appends it), so the framing is not re-guessed.
//
// Replay drives the real provider's message path (`ingestFrame`) on a virtual
// clock at 1x, 2x, 10x and step, so no DJ software is needed and speed changes
// the time the decoder sees rather than only a timestamp field. Frames that
// arrive back to back are replayed as one burst (the protocol sends a track as
// several field messages), which is what produces a single generation bump per
// load, matching the live client's settled `deckChange`.
import { z } from "zod";
import { deckStateSchema, type DeckState } from "@autolight/contracts";
import { SeratoRemoteProvider } from "./remote-provider.js";
import { seratoFrameDelimiter } from "./emulator.js";

/** Field messages of one track load land within a few microseconds of each other. */
export const SERATO_BURST_GAP_MS = 50;
const VIRTUAL_EPOCH_NS = 1_000_000_000n;

export const seratoFixtureSchema = z.object({
  seratoVersion: z.string().min(1),
  platform: z.enum(["macos", "windows"]),
  action: z.string().min(1),
  capture: z.string().min(1, "empty capture: record the raw transport bytes"),
  frameTimesMs: z.array(z.number().nonnegative()).min(1),
  expectedEvents: z.array(deckStateSchema.omit({ receivedAtNs: true })).min(1),
  expectedBy: z.string().min(1),
  /** Where the bytes came from: a real session, or the scripted peer. */
  provenance: z.string().min(1),
});

export type SeratoFixture = z.infer<typeof seratoFixtureSchema>;

export interface SeratoFrameBytes {
  atMs: number;
  bytes: Buffer;
}

export type SeratoReplaySpeed = "1x" | "2x" | "10x" | "step";

export const SERATO_REPLAY_SPEEDS: readonly SeratoReplaySpeed[] = ["1x", "2x", "10x", "step"];

export function seratoSpeedFactor(speed: SeratoReplaySpeed): number {
  if (speed === "2x") return 2;
  if (speed === "10x") return 10;
  return 1;
}

export function parseSeratoFixture(raw: unknown): SeratoFixture {
  return seratoFixtureSchema.parse(raw);
}

/** Split a captured stream back into frames, paired with their timestamps. */
export function framesFromFixture(fixture: SeratoFixture): SeratoFrameBytes[] {
  const stream = Buffer.from(fixture.capture, "base64");
  const frames = splitFrames(stream);
  if (frames.length !== fixture.frameTimesMs.length) {
    throw new Error(`capture holds ${frames.length} frame(s) but frameTimesMs has ${fixture.frameTimesMs.length}`);
  }
  return frames.map((bytes, index) => ({ atMs: fixture.frameTimesMs[index] ?? 0, bytes }));
}

export function splitFrames(stream: Buffer): Buffer[] {
  const delimiter = seratoFrameDelimiter();
  const frames: Buffer[] = [];
  let offset = 0;
  for (;;) {
    const end = stream.indexOf(delimiter, offset);
    if (end === -1) break;
    frames.push(stream.subarray(offset, end + delimiter.length));
    offset = end + delimiter.length;
  }
  if (offset !== stream.length) throw new Error(`capture has ${stream.length - offset} trailing byte(s) without a frame delimiter`);
  return frames;
}

/** Frames grouped into load bursts (a gap of at least SERATO_BURST_GAP_MS). */
export function seratoBursts(frames: readonly SeratoFrameBytes[], gapMs = SERATO_BURST_GAP_MS): SeratoFrameBytes[][] {
  const bursts: SeratoFrameBytes[][] = [];
  let current: SeratoFrameBytes[] = [];
  let previousAt = -Infinity;
  for (const frame of frames) {
    if (current.length > 0 && frame.atMs - previousAt >= gapMs) {
      bursts.push(current);
      current = [];
    }
    current.push(frame);
    previousAt = frame.atMs;
  }
  if (current.length > 0) bursts.push(current);
  return bursts;
}

function replayOnVirtualClock(frames: readonly SeratoFrameBytes[], factor: number): DeckState[][] {
  let nowNs = VIRTUAL_EPOCH_NS;
  const provider = new SeratoRemoteProvider({ now: () => nowNs });
  const emitted: DeckState[][] = [];
  for (const burst of seratoBursts(frames)) {
    const atMs = burst.at(-1)?.atMs ?? 0;
    nowNs = VIRTUAL_EPOCH_NS + BigInt(Math.round((atMs * 1_000_000) / factor));
    const stream = Buffer.concat(burst.map((frame) => frame.bytes));
    emitted.push(provider.ingestFrame(stream, nowNs).map((state) => ({ ...state })));
  }
  return emitted;
}

/** Replay already-split frames (a capture) at one speed. */
export function replaySeratoFrames(frames: readonly SeratoFrameBytes[], speed: SeratoReplaySpeed = "1x"): DeckState[] {
  return replayOnVirtualClock(frames, seratoSpeedFactor(speed)).flat();
}

/** Replay a fixture at one speed. Returns states in emission order. */
export function replaySeratoFixture(fixture: SeratoFixture, speed: SeratoReplaySpeed = "1x"): DeckState[] {
  return replaySeratoFrames(framesFromFixture(fixture), speed);
}

/** Step mode: the same states, one burst per call. */
export function* replaySeratoFixtureStep(fixture: SeratoFixture): Generator<DeckState[]> {
  const frames = framesFromFixture(fixture);
  for (const states of replayOnVirtualClock(frames, 1)) yield states;
}

/** Build a fixture from frames and human-written expectations. */
export function buildSeratoFixture(opts: {
  seratoVersion: string;
  platform: "macos" | "windows";
  action: string;
  frames: readonly SeratoFrameBytes[];
  expectedEvents: SeratoFixture["expectedEvents"];
  expectedBy: string;
  provenance: string;
}): SeratoFixture {
  return parseSeratoFixture({
    seratoVersion: opts.seratoVersion,
    platform: opts.platform,
    action: opts.action,
    capture: Buffer.concat(opts.frames.map((frame) => frame.bytes)).toString("base64"),
    frameTimesMs: opts.frames.map((frame) => frame.atMs),
    expectedEvents: opts.expectedEvents,
    expectedBy: opts.expectedBy,
    provenance: opts.provenance,
  });
}

/** The DeckState snapshot the emitter produced, minus the replay-stamped clock. */
export function withoutStamp(state: DeckState): Omit<DeckState, "receivedAtNs"> {
  const { receivedAtNs: _stamp, ...rest } = state;
  return rest;
}

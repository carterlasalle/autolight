// Serato live transport (serato-connect) + disk GEOB complement each other (§3.1).
// Remote → identity/playhead/rate/faders; files → grid/cues/crates.
import type { DeckState } from "@autolight/contracts";

export interface SeratoCrateEntry { path: string }

// Minimal .crate parser: vrsn header + otrk rows with ptrk UTF-16BE paths.
// Throws on bad magic so corrupt crates fail loudly.
export function parseCrate(buf: Uint8Array): SeratoCrateEntry[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(...buf.slice(0, 4));

  if (magic !== "vrsn") throw new Error(`bad crate magic ${JSON.stringify(magic)}`);
  const readU32 = (o: number): number => v.getUint32(o, false);
  const readTag = (o: number): string => String.fromCharCode(...buf.slice(o, o + 4));
  const vlen = readU32(4);
  let o = 8 + vlen;
  const out: SeratoCrateEntry[] = [];

  const decodePath = (start: number, len: number): string => {
    const raw = buf.slice(start, start + len);
    let s = "";

    for (let i = 0; i + 1 < raw.length; i += 2) s += String.fromCharCode((raw[i]! << 8) | raw[i + 1]!);

    return s;
  };

  while (o + 8 <= buf.length) {
    const tag = readTag(o);
    const len = readU32(o + 4);
    o += 8;

    if (o + len > buf.length) {
      throw new Error(`crate record overruns the file: ${tag} at ${o - 8} claims ${len} bytes, only ${buf.length - o} left`);
    }

    if (tag === "otrk") {
      let j = o;

      while (j + 8 <= o + len) {
        const it = readTag(j);
        const il = readU32(j + 4);
        j += 8;

        if (j + il > o + len) {
          throw new Error(`crate row overruns its otrk: ${it} at ${j - 8} claims ${il} bytes, only ${o + len - j} left`);
        }

        if (it === "ptrk") out.push({ path: decodePath(j, il) });
        j += il;
      }
    }

    o += len;
  }

  return out;
}

// Serato Remote deck snapshot → DeckState (§3.1, §9.5 decoder requirements).
// Field coalescing on track change: filepath arrives with the new track, so
// stale loop/fader values reset unless re-asserted in the same message.
export interface SeratoRemoteDeck {
  deckId: number;
  filepath: string | null;
  playing: boolean;
  playheadSeconds: number;
  playRate: number;
  effectiveBpm: number | null;
  loopActive: boolean;
  loopStartSeconds: number | null;
  loopEndSeconds: number | null;
  loopBeatLength: number | null;
  channelFader: number | null;
  crossfader: number | null;
  trackChanged: boolean;
  raw: Record<string, unknown>;
}

export function remoteToDeckState(msg: SeratoRemoteDeck, receivedAtNs: bigint): { state: DeckState; raw: Record<string, unknown> } {
  const loop = msg.trackChanged && !msg.loopActive
    ? { active: false, startSeconds: null, endSeconds: null, beatLength: null }
    : { active: msg.loopActive, startSeconds: msg.loopStartSeconds, endSeconds: msg.loopEndSeconds, beatLength: msg.loopBeatLength };

  return {
    state: {
      source: "serato",
      deckId: msg.deckId,
      track: msg.filepath ? { id: `path:${msg.filepath}`, sourceIds: { seratoPath: msg.filepath }, canonicalPath: msg.filepath } : null,
      playing: msg.playing,
      playheadSeconds: msg.playheadSeconds,
      playRate: msg.playRate,
      effectiveBpm: msg.effectiveBpm,
      loop,
      channelFader: msg.channelFader,
      crossfader: msg.crossfader,
      master: null,
      receivedAtNs,
    },
    raw: msg.raw,
  };
}

// Serato BeatGrid GEOB (§3.1 disk side): version byte 0x01, u32 BE reserved,
// u8 marker count, then per marker: f32 BE position (seconds) + f32 BE BPM.
// Verified live against ScratchBeat4 (85 BPM @ 0.046s) + ScratchBeat5 (88 BPM).
// Throws on bad magic/version so corrupt tags fail loudly, never silently.
export interface SeratoTempoRegion { startSeconds: number; bpm: number; beatInBar: 1 | 2 | 3 | 4 }

export function parseBeatGrid(payload: Uint8Array): SeratoTempoRegion[] {
  const v = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  if (payload.length < 6) throw new Error(`beatgrid too short: ${payload.length}`);

  if (payload[0] !== 0x01) throw new Error(`beatgrid version=${payload[0]}, expected 1`);
  // Header per serato-connect/serato-tags: 2 unknown bytes, then the marker
  // count as a u32 BE at offset 2. Reading one byte at offset 5 only
  // coincides for counts up to 255 (batch-44).
  const count = v.getUint32(2, false);

  if (payload.length < 6 + count * 8) throw new Error(`beatgrid truncated: need ${6 + count * 8}, got ${payload.length}`);
  const out: SeratoTempoRegion[] = [];

  for (let i = 0; i < count; i++) {
    const startSeconds = v.getFloat32(6 + i * 8, false);

    if (i < count - 1) {
      // Non-terminal marker: u32 BE beats-to-next, then the next marker's
      // position gives the span; its tempo is the beats over that span.
      const beatsToNext = v.getUint32(10 + i * 8, false);
      const nextSeconds = v.getFloat32(14 + i * 8, false);
      const span = nextSeconds - startSeconds;
      const bpm = (beatsToNext * 60) / span;

      // A non-positive or non-finite span would divide into Infinity/NaN
      // downstream (region lengths, beat lists); loud beats silent (batch-03).
      if (!Number.isFinite(bpm) || bpm <= 0) {
        throw new Error(`beatgrid marker ${i} spans ${beatsToNext} beats over ${span} s, expected a positive span`);
      }

      out.push({ startSeconds, bpm, beatInBar: 1 });
      continue;
    }

    // Terminal marker (the last): position + BPM.
    const bpm = v.getFloat32(10 + i * 8, false);

    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new Error(`beatgrid marker ${i} has bpm ${bpm}, expected a finite positive tempo`);
    }

    out.push({ startSeconds, bpm, beatInBar: 1 });
  }

  return out;
}

export function tempoRegionsToBeats(regions: SeratoTempoRegion[]): { index: number; beatInBar: 1 | 2 | 3 | 4; sourceTimeMs: number; bpm: number }[] {
  const out: { index: number; beatInBar: 1 | 2 | 3 | 4; sourceTimeMs: number; bpm: number }[] = [];
  regions.forEach((r, ri) => {
    // A zero or non-finite tempo would divide into Infinity/NaN region
    // lengths and beat spacing below; fail loudly here too, since callers
    // can hand-build regions without parseBeatGrid (batch-03).
    if (!Number.isFinite(r.bpm) || r.bpm <= 0) {
      throw new Error(`tempo region ${ri} has bpm ${r.bpm}, expected a finite positive tempo`);
    }

    const startBeat = out.length;
    const nextStart = regions[ri + 1]?.startSeconds;
    const regionLen = nextStart !== undefined ? nextStart - r.startSeconds : 60 / r.bpm * 4;
    const count = Math.max(1, Math.round(regionLen / (60 / r.bpm)));

    for (let i = 0; i < count; i++) {
      out.push({ index: startBeat + i, beatInBar: (((r.beatInBar - 1 + i) % 4) + 1) as 1 | 2 | 3 | 4, sourceTimeMs: (r.startSeconds + i * (60 / r.bpm)) * 1000, bpm: r.bpm });
    }
  });

  return out;
}

// T-SER-01/04/05 surface: the Remote provider and its setup assistant, the
// scripted peer and capture proxy, the library/crate/smart-crate readers with
// the DS-35 watcher, and the fixture replay harness. Fixture writers stay out
// of the public surface on purpose: this package reads DJ data, never writes
// it (T-SEC-04).
export * from "./remote-provider.js";

export * from "./setup.js";

export * from "./emulator.js";

export * from "./capture.js";

export * from "./library.js";

export * from "./replay.js";

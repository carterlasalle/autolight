// OS2L provider (`os2l`, T-LIVE-10, F-LIVE-10).
//
// OS2L (os2l.org, read in full: spec page plus the OS2L.cpp reference
// implementation) is a local TCP JSON protocol where AutoLight acts as the
// service side: we advertise `_os2l._tcp` over DNS-SD, listen on a port of
// our choice (reference range 8010 to 8060), and DJ software connects and
// sends newline separated JSON messages. No code is copied: framing,
// validation and mapping below are our own, written from the documented
// message grammar.
//
// Messages handled, per the spec:
// - beat: evt=beat, pos (beat number; pos%4==0 on 4:4 bar lines), bpm,
//   change (phase or bpm changed), optional strength percent. Maps to the
//   master deck: effectiveBpm exact, beat derived, playhead estimated from
//   the beat counter at the announced tempo.
// - btn: evt=btn, name, optional page, state on/off. Retained as hot-cue and
//   loop hints (name matching is documented in the provider, case
//   insensitive): blackout is ignored as transport, cue/play names map to
//   playing hints, loop/roll names map to loop-roll hints.
// - cmd: evt=cmd, id, param 0..100. Retained under raw for mapping, never
//   acted on directly.
// - feedback: evt=feedback, the one message WE send (DMX side to audio
//   side) to mirror button state back to the DJ software.
//
// Framing: the reference implementation reads up to 4096 bytes and parses
// consecutive JSON objects from the buffer. We split on newlines AND parse
// consecutive objects, keep a bounded tail across TCP chunks (1 MiB cap),
// and reject plus count anything that does not parse, never throwing into
// the manager. DNS-SD advertisement is the host's job (Electron main); this
// module exposes the service type and port range constants plus the TCP
// accept path, which tests drive over a real loopback socket.
//
// Quality: OS2L carries beats, not a playhead, so playheadSeconds is
// `estimated` and effectiveBpm is `exact` once a beat message arrives.
// Sources: rkbx_os2l on Windows, VirtualDJ, any OS2L speaker. Also a
// fallback clock for the adaptive director (DS-23).
import { createServer, type Server, type Socket } from "node:net";
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

export const OS2L_PROVIDER_ID = "os2l" as const satisfies ProviderId;
export const OS2L_SERVICE_TYPE = "_os2l._tcp";
export const OS2L_PORT_MIN = 8010;
export const OS2L_PORT_MAX = 8060;
export const OS2L_MAX_BUFFER = 1024 * 1024;
const os2lBeatSchema = z.object({
  evt: z.literal("beat"),
  pos: z.number(),
  bpm: z.number(),
  change: z.boolean().optional(),
  strength: z.number().optional(),
}).catchall(z.unknown());

const os2lButtonSchema = z.object({
  evt: z.literal("btn"),
  name: z.string(),
  page: z.string().optional(),
  state: z.enum(["on", "off"]),
}).catchall(z.unknown());

const os2lCommandSchema = z.object({
  evt: z.literal("cmd"),
  id: z.number(),
  param: z.number(),
}).catchall(z.unknown());

const os2lFeedbackSchema = z.object({
  evt: z.literal("feedback"),
  name: z.string().optional(),
  page: z.string().optional(),
  state: z.enum(["on", "off"]).optional(),
  id: z.number().optional(),
  param: z.number().optional(),
}).catchall(z.unknown());

const os2lMessageSchema = z.union([os2lBeatSchema, os2lButtonSchema, os2lCommandSchema, os2lFeedbackSchema]);

export type Os2lBeat = z.infer<typeof os2lBeatSchema>;
export type Os2lButton = z.infer<typeof os2lButtonSchema>;
export type Os2lCommand = z.infer<typeof os2lCommandSchema>;
export type Os2lMessage = z.infer<typeof os2lMessageSchema>;

export interface Os2lDecodeResult {
  readonly messages: Os2lMessage[];
  readonly malformed: string[];
}

// Split a chunk into complete JSON message texts: newline separated, with
// consecutive objects on one line also split. Returns complete texts plus the
// incomplete tail to prepend to the next chunk. Text that can never become
// part of a message (non-whitespace outside objects, excluding the tail) is
// reported as garbage so callers reject and count it.
export function splitOs2lMessages(chunk: string): { texts: string[]; tail: string; garbage: string[] } {
  const texts: string[] = [];
  const garbage: string[] = [];
  let tail = "";
  for (const line of chunk.split("\n")) {
    const part = tail + line;
    tail = "";
    let depth = 0;
    let inString = false;
    let escaped = false;
    let start = -1;
    let outside = "";
    for (let i = 0; i < part.length; i++) {
      const ch = part[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") {
        if (depth === 0) start = i;
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          texts.push(part.slice(start, i + 1));
          start = -1;
        }
        if (depth < 0) depth = 0;
      } else if (depth === 0 && start < 0 && ch !== " " && ch !== "\r" && ch !== "\t") {
        outside += ch;
      }
    }
    if (start >= 0) tail = part.slice(start);
    else if (outside.trim().length > 0) garbage.push(outside.trim());
  }
  return { texts, tail, garbage };
}

export function decodeOs2lText(text: string): Os2lDecodeResult {
  const split = splitOs2lMessages(text);
  const messages: Os2lMessage[] = [];
  const malformed: string[] = split.garbage.map((g) => `bad OS2L input ${g.slice(0, 80)}`);
  for (const item of split.texts) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(item);
    } catch {
      malformed.push(`bad OS2L message ${item.slice(0, 80)}: not JSON`);
      continue;
    }
    const result = os2lMessageSchema.safeParse(parsed);
    if (result.success) messages.push(result.data);
    else malformed.push(`bad OS2L message ${item.slice(0, 80)}: ${result.error.message}`);
  }
  return { messages, malformed };
}

export function formatOs2lFeedback(name: string, state: "on" | "off", page?: string): string {
  return page
    ? JSON.stringify({ evt: "feedback", name, page, state })
    : JSON.stringify({ evt: "feedback", name, state });
}

function beatInBarOf(pos: number): 1 | 2 | 3 | 4 | null {
  const slot = ((Math.floor(pos) % 4) + 4) % 4 + 1;
  return slot === 1 || slot === 2 || slot === 3 || slot === 4 ? slot : null;
}

export interface Os2lProviderOptions {
  now?: ClockFn;
  bind?: string | null;
}

interface Os2lDeckBuffer {
  bpm: number | null;
  beat: number | null;
  beatInBar: 1 | 2 | 3 | 4 | null;
  playing: boolean | null;
  loopActive: boolean | null;
  lastHotCue: number | null;
  commands: { id: number; param: number }[];
  epoch: number;
  lastPos: number | null;
}

function emptyOs2lBuffer(): Os2lDeckBuffer {
  return { bpm: null, beat: null, beatInBar: null, playing: null, loopActive: null, lastHotCue: null, commands: [], epoch: 0, lastPos: null };
}

const BUTTON_PLAY = ["play", "pause", "cue-play", "start", "stop"];
const BUTTON_LOOP = ["loop", "autoloop", "loop-roll", "roll"];

export class Os2lProvider extends ProviderBase {
  private readonly mapper = new DeckGenerationMapper();
  private readonly capabilities: ProviderCapabilities = {
    master: true, loop: true, pitch: false, sync: false, hotCue: true, roll: true,
  };
  private readonly bindHost: string | null;
  private readonly bindPort: number;
  private buffer: Os2lDeckBuffer = emptyOs2lBuffer();
  private tail = "";
  private server: Server | null = null;
  private sockets = new Set<Socket>();
  private lastBeatAtNs: bigint | null = null;

  constructor(opts: Os2lProviderOptions = {}) {
    super(OS2L_PROVIDER_ID, "rekordbox", opts.now);
    if (opts.bind === undefined || opts.bind === null) {
      this.bindHost = null;
      this.bindPort = 0;
    } else {
      const at = opts.bind.lastIndexOf(":");
      this.bindHost = at >= 0 ? opts.bind.slice(0, at) : opts.bind;
      this.bindPort = at >= 0 ? Number(opts.bind.slice(at + 1)) : 0;
    }
  }

  protected async onStart(): Promise<void> {
    if (this.bindHost === null) {
      this.setStatus({ state: "starting" });
      return;
    }
    const server = createServer((socket) => {
      this.sockets.add(socket);
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => this.ingestChunk(chunk));
      socket.on("close", () => this.sockets.delete(socket));
      socket.on("error", () => this.sockets.delete(socket));
    });
    this.server = server;
    server.on("error", (err: Error) => {
      this.setStatus({ state: "failed", error: `os2l socket: ${err.message}` });
    });
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.once("error", reject);
    server.listen(this.bindPort, this.bindHost, () => {
      server.off("error", reject);
      this.setStatus({ state: "starting" });
      resolve();
    });
    await promise.catch((err: unknown) => {
      this.setStatus({ state: "failed", error: `os2l bind: ${err instanceof Error ? err.message : String(err)}` });
      throw err;
    });
  }

  protected async onStop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const server = this.server;
    this.server = null;
    if (!server) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    server.close(() => resolve());
    await promise;
  }

  get boundPort(): number | null {
    const address = this.server?.address();
    return address && typeof address === "object" ? address.port : null;
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  getDecks(): readonly ProviderDeckState[] {
    if (this.buffer.beat === null && this.buffer.bpm === null) return [];
    return [this.stateFor(1)];
  }

  sendFeedback(name: string, state: "on" | "off", page?: string): void {
    const line = formatOs2lFeedback(name, state, page) + "\n";
    for (const socket of this.sockets) socket.write(line);
  }

  ingestText(text: string, atNs?: bigint): Os2lDecodeResult {
    return this.ingestChunk(text, atNs);
  }

  private ingestChunk(chunk: string, atNs?: bigint): Os2lDecodeResult {
    const at = atNs ?? this.now();
    const combined = this.tail + chunk;
    if (combined.length > OS2L_MAX_BUFFER) {
      this.tail = "";
      this.markRejected("os2l buffer over 1 MiB, dropped");
      return { messages: [], malformed: ["buffer over 1 MiB"] };
    }
    const split = splitOs2lMessages(combined);
    this.tail = split.tail;
    const messages: Os2lMessage[] = [];
    const malformed: string[] = split.garbage.map((g) => `bad OS2L input ${g.slice(0, 80)}`);
    for (const item of split.texts) {
      try {
        const message = os2lMessageSchema.parse(JSON.parse(item));
        messages.push(message);
        this.applyMessage(message, at);
      } catch (err) {
        malformed.push(`bad OS2L message ${item.slice(0, 80)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (malformed.length > 0) this.markRejected(malformed[0] ?? "malformed OS2L input");
    else if (messages.length > 0) this.setStatus({ state: "live", updateHz: 0, ageMs: 0 });
    if (messages.length > 0) this.emit(this.stateFor(1, at));
    return { messages, malformed };
  }

  private applyMessage(message: Os2lMessage, atNs: bigint): void {
    if (message.evt === "beat") {
      const previous = this.buffer.lastPos;
      if (previous !== null && message.pos < previous) {
        this.buffer.epoch += 1;
      }
      this.buffer.lastPos = message.pos;
      this.buffer.bpm = message.bpm;
      this.buffer.beat = message.pos;
      this.buffer.beatInBar = beatInBarOf(message.pos);
      this.lastBeatAtNs = atNs;
      return;
    }
    if (message.evt === "btn") {
      const name = message.name.toLowerCase();
      const on = message.state === "on";
      if (BUTTON_PLAY.includes(name)) this.buffer.playing = on;
      else if (BUTTON_LOOP.includes(name)) this.buffer.loopActive = on;
      else if (name.startsWith("hotcue") || name.startsWith("hot cue")) {
        const number = Number(name.replace(/[^0-9]/g, ""));
        if (on && Number.isInteger(number)) this.buffer.lastHotCue = number;
      } else if (name === "cue" && on) {
        this.buffer.lastHotCue = 0;
      }
      return;
    }
    if (message.evt === "cmd") {
      this.buffer.commands.push({ id: message.id, param: message.param });
      if (this.buffer.commands.length > 32) this.buffer.commands.shift();
    }
  }

  private estimatePlayhead(atNs: bigint): number {
    if (this.buffer.beat === null || this.buffer.bpm === null || this.lastBeatAtNs === null) return 0;
    const elapsedBeats = (Number(atNs - this.lastBeatAtNs) / 1e9) * (this.buffer.bpm / 60);
    return Math.max(0, (this.buffer.beat + elapsedBeats) * 60 / this.buffer.bpm);
  }

  private stateFor(deckId: number, atNs?: bigint): ProviderDeckState {
    const at = atNs ?? this.now();
    const raw: Record<string, unknown> = {
      provider: OS2L_PROVIDER_ID,
      commands: [...this.buffer.commands],
    };
    const state = this.mapper.update(this.id, {
      deckId,
      atNs: at,
      playing: this.buffer.playing ?? true,
      playheadSeconds: this.estimatePlayhead(at),
      effectiveBpm: this.buffer.bpm,
      beat: this.buffer.beat,
      beatInBar: this.buffer.beatInBar,
      master: true,
      loopRoll: this.buffer.loopActive === null
        ? null
        : { active: this.buffer.loopActive, beatLength: null },
      hotCue: this.buffer.lastHotCue === null ? null : { number: this.buffer.lastHotCue, atNs: at },
      quality: this.qualityFor(),
    });
    return { ...state, raw };
  }

  private qualityFor(): Partial<Record<keyof ProviderDeckState, QualityLabel>> {
    return {
      playheadSeconds: "estimated",
      playing: "derived",
      effectiveBpm: "exact",
      beat: "derived",
      master: "derived",
    };
  }
}

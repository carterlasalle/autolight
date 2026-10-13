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
  pos: z.number().finite().nonnegative(),
  bpm: z.number().finite().positive(),
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

export const os2lFeedbackSchema = z.object({
  evt: z.literal("feedback"),
  name: z.string().optional(),
  page: z.string().optional(),
  state: z.enum(["on", "off"]).optional(),
  id: z.number().optional(),
  param: z.number().optional(),
}).catchall(z.unknown());

// Inbound frames from DJ software: beat, button and command only. Feedback
// is the one message WE send (formatOs2lFeedback / sendFeedback); a client
// echoing it back is not processed input.
const os2lMessageSchema = z.union([os2lBeatSchema, os2lButtonSchema, os2lCommandSchema]);

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

    if (start >= 0) {
      if (outside.trim().length > 0) garbage.push(outside.trim());
      tail = part.slice(start);
    } else if (outside.trim().length > 0) garbage.push(outside.trim());
  }

  return { texts, tail, garbage };
}

/** Parse one complete JSON frame text into an inbound message or a malformed report. */
function parseOs2lText(item: string): Os2lDecodeResult {
  let parsed: unknown = null;

  try {
    parsed = JSON.parse(item);
  } catch {
    return { messages: [], malformed: [`bad OS2L message ${item.slice(0, 80)}: not JSON`] };
  }

  const result = os2lMessageSchema.safeParse(parsed);

  if (result.success) return { messages: [result.data], malformed: [] };

  return { messages: [], malformed: [`bad OS2L message ${item.slice(0, 80)}: ${result.error.message}`] };
}

// Bind grammar: "[host]:port", "host:port", "host" (port 0) or ":port".
// A bare "::1" is a host, not host:port. Ports outside 0 (ephemeral) or the
// advertised OS2L range fall back to 0 so listen() never gets a bad value.
function splitOs2lBind(bind: string): [string, number] {
  if (bind.startsWith("[") && bind.includes("]")) {
    const end = bind.indexOf("]");
    const host = bind.slice(1, end);
    const rest = bind.slice(end + 1);
    const port = rest.startsWith(":") ? Number(rest.slice(1)) : 0;

    return [host.length > 0 ? host : "127.0.0.1", clampOs2lPort(port)];
  }

  const at = bind.lastIndexOf(":");

  // More than one colon outside brackets is a bare IPv6 host (no port);
  // splitting it would bind the wrong interface.
  if (at < 0 || (bind.match(/:/g) ?? []).length > 1) return [bind, 0];
  const host = bind.slice(0, at);

  return [host.length > 0 ? host : "127.0.0.1", clampOs2lPort(Number(bind.slice(at + 1)))];
}

function clampOs2lPort(port: number): number {
  if (!Number.isFinite(port) || port < 0) return 0;

  if (port === 0) return 0;

  if (port >= OS2L_PORT_MIN && port <= OS2L_PORT_MAX) return Math.floor(port);

  return 0;
}

export function decodeOs2lText(text: string): Os2lDecodeResult {
  const split = splitOs2lMessages(text);
  const messages: Os2lMessage[] = [];
  const malformed: string[] = split.garbage.map((g) => `bad OS2L input ${g.slice(0, 80)}`);

  for (const item of split.texts) {
    const parsed = parseOs2lText(item);
    messages.push(...parsed.messages);
    malformed.push(...parsed.malformed);
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
  cumulativeBeats: number;
  lastPos: number | null;
}

function emptyOs2lBuffer(): Os2lDeckBuffer {
  return { bpm: null, beat: null, beatInBar: null, playing: null, loopActive: null, lastHotCue: null, commands: [], cumulativeBeats: 0, lastPos: null };
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
      const parsed = splitOs2lBind(opts.bind);
      this.bindHost = parsed[0];
      this.bindPort = parsed[1];
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

    const onListenError = (err: Error): void => {
      this.setStatus({ state: "failed", error: `os2l socket: ${err.message}` });
    };

    server.on("error", onListenError);
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

    if (server) server.removeAllListeners("error");

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

    for (const socket of this.sockets) {
      if (socket.writable && !socket.destroyed) socket.write(line);
    }
  }
  ingestText(text: string, atNs?: bigint): Os2lDecodeResult {
    return this.ingestChunk(text, atNs);
  }

  private ingestChunk(chunk: string, atNs?: bigint): Os2lDecodeResult {
    const at = atNs ?? this.now();
    this.tail += chunk;

    if (this.tail.length > OS2L_MAX_BUFFER) {
      const split = splitOs2lMessages(this.tail);
      const messages: Os2lMessage[] = [];
      const malformed: string[] = split.garbage.map((g) => `bad OS2L input ${g.slice(0, 80)}`);

      for (const item of split.texts) {
        const parsed = parseOs2lText(item);
        messages.push(...parsed.messages);
        malformed.push(...parsed.malformed);
      }

      for (const message of messages) this.applyMessage(message, at);
      this.tail = split.tail.slice(-1024);

      if (messages.length > 0) this.setStatus({ state: "live", updateHz: 0, ageMs: 0 });

      if (messages.length > 0) this.emit(this.stateFor(1, at));
      this.markRejected("os2l buffer over 1 MiB, dropped");

      return { messages, malformed: [...malformed, "buffer over 1 MiB"] };
    }

    const split = splitOs2lMessages(this.tail);
    this.tail = split.tail;
    const messages: Os2lMessage[] = [];
    const malformed: string[] = split.garbage.map((g) => `bad OS2L input ${g.slice(0, 80)}`);

    for (const item of split.texts) {
      const parsed = parseOs2lText(item);
      messages.push(...parsed.messages);

      for (const message of parsed.messages) this.applyMessage(message, at);
      malformed.push(...parsed.malformed);
    }

    if (messages.length > 0) this.setStatus({ state: "live", updateHz: 0, ageMs: 0 });

    if (malformed.length > 0) this.markRejected(malformed[0] ?? "malformed OS2L input");

    if (messages.length > 0) this.emit(this.stateFor(1, at));

    return { messages, malformed };
  }
  private applyMessage(message: Os2lMessage, atNs: bigint): void {
    if (message.evt === "beat") {
      const previous = this.buffer.lastPos;
      // Loop/reset rewind: carry the wrapped beats forward so the playhead
      // stays monotonic instead of jumping backwards on every loop.
      const wrapped = previous === null ? 0 : Math.max(0, previous - message.pos);
      this.buffer.cumulativeBeats += wrapped;
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

    return Math.max(0, (this.buffer.cumulativeBeats + this.buffer.beat + elapsedBeats) * 60 / this.buffer.bpm);
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

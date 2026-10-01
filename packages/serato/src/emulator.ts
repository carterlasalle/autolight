// Serato Remote emulator and scripted capture source (T-SER-01, T-SER-05).
//
// The wp09 task says: "drive serato-connect's own test fixtures or a scripted
// peer that speaks the Remote protocol over a real TCP socket (built from the
// serato-connect tests, so the emulator is not our guess of the protocol)."
// The published package ships dist only, so this module is the scripted peer:
// every frame it sends is built with serato-connect's own codec (`osc`, `arg`,
// `frameOsc`) and every frame it reads is split with serato-connect's own
// framer (`FrameReader`), which is the same code the server side runs. The
// emulator plays the Serato side of the documented handshake:
//
//   peer -> /StreamMgmt/Authorize/Request (16-byte nonce blob)
//   peer <- /StreamMgmt/Authorize/Response (peerName, peerUuid, MD5 digest)
//   peer -> /StreamMgmt/Pairing/Pair (name, uuid, 0)
//   peer <- /StreamMgmt/Pairing/Pair (name, uuid, 1)
//   peer <- /Register/Status/<topic> (once per subscribed topic)
//
// Action scripts cover the spec 119 manipulations the Remote protocol can
// express. Actions it cannot express (scratch, reverse, sync toggles, hot
// cues, master switch) have no script and no fixture: the protocol carries no
// message for them, which the evidence records rather than inventing frames.
import { connect, type Socket } from "node:net";
import { FrameReader, arg, frameOsc, osc, type OscArg, type OscMessage } from "serato-connect";

export const SERATO_ACTIONS = [
  "load-deck-1",
  "load-deck-2",
  "play",
  "pause",
  "seek",
  "loop-4-beat",
  "loop-1-beat",
  "loop-roll",
  "pitch-plus-8",
  "crossfader",
  "upfader",
  "two-decks",
  "replace-track",
  "eject-deck-1",
] as const;

export type SeratoAction = (typeof SERATO_ACTIONS)[number];

export interface SeratoScriptStep {
  atMs: number;
  message: OscMessage;
}

export interface SeratoFrame {
  atMs: number;
  bytes: Buffer;
}

/**
 * The 16-byte frame delimiter, read from serato-connect's own `frameOsc`
 * output rather than copied as a constant, so a delimiter change in the
 * dependency cannot silently invalidate our captures.
 */
export function seratoFrameDelimiter(): Buffer {
  return frameOsc(osc("/Ping")).subarray(-16);
}

/** Deck index on the wire: serato-connect maps 0..3 to decks 1..4. */
function deckIndex(deckId: number): OscArg {
  return arg.i(deckId - 1);
}

function trackMessages(deckId: number, filePath: string, title: string, artist: string): OscMessage[] {
  return [
    osc("/Status/Deck/Song/Title", deckIndex(deckId), arg.s(title)),
    osc("/Status/Deck/Song/Artist", deckIndex(deckId), arg.s(artist)),
    osc("/Status/Deck/Song/Filepath", deckIndex(deckId), arg.s(filePath)),
    osc("/Status/Deck/Song/Valid", deckIndex(deckId), arg.f(1)),
  ];
}

function playheadMessage(deckId: number, positionSeconds: number, playRate: number, bpm: number): OscMessage {
  return osc("/Status/Deck/Playhead", deckIndex(deckId), arg.f(positionSeconds), arg.f(playRate), arg.f(bpm));
}

function autoLoopMessage(deckId: number, on: boolean): OscMessage {
  return osc("/Status/Deck/Loop/AutoLoopOn", deckIndex(deckId), arg.f(on ? 1 : 0));
}

/** Scripted timeline for one spec 119 action the Remote protocol can express. */
export function seratoActionScript(action: SeratoAction): SeratoScriptStep[] {
  const steps: SeratoScriptStep[] = [];
  const add = (atMs: number, message: OscMessage): void => {
    steps.push({ atMs, message });
  };
  switch (action) {
    case "load-deck-1":
      for (const [i, message] of trackMessages(1, "/music/fixture-a.mp3", "Fixture A", "Emulator").entries()) {
        add(i * 4, message);
      }
      add(20, playheadMessage(1, 0, 0, 124));
      break;
    case "load-deck-2":
      for (const [i, message] of trackMessages(2, "/music/fixture-b.mp3", "Fixture B", "Emulator").entries()) {
        add(i * 4, message);
      }
      add(20, playheadMessage(2, 0, 0, 126));
      break;
    case "play":
      add(0, trackMessages(1, "/music/fixture-a.mp3", "Fixture A", "Emulator")[2] as OscMessage);
      add(20, playheadMessage(1, 0, 1, 124));
      add(120, playheadMessage(1, 2, 1, 124));
      break;
    case "pause":
      add(0, trackMessages(1, "/music/fixture-a.mp3", "Fixture A", "Emulator")[2] as OscMessage);
      add(20, playheadMessage(1, 0, 1, 124));
      add(120, playheadMessage(1, 2, 1, 124));
      add(200, playheadMessage(1, 2, 0, 124));
      break;
    case "seek":
      add(0, trackMessages(1, "/music/fixture-a.mp3", "Fixture A", "Emulator")[2] as OscMessage);
      add(20, playheadMessage(1, 0, 1, 124));
      add(120, playheadMessage(1, 30, 1, 124));
      break;
    case "loop-4-beat":
      add(0, trackMessages(1, "/music/fixture-a.mp3", "Fixture A", "Emulator")[2] as OscMessage);
      add(20, playheadMessage(1, 0, 1, 124));
      add(60, osc("/Status/Deck/Loop/BeatLength", deckIndex(1), arg.f(4)));
      add(64, autoLoopMessage(1, true));
      break;
    case "loop-1-beat":
      add(0, trackMessages(1, "/music/fixture-a.mp3", "Fixture A", "Emulator")[2] as OscMessage);
      add(20, playheadMessage(1, 0, 1, 124));
      add(60, osc("/Status/Deck/Loop/BeatLength", deckIndex(1), arg.f(1)));
      add(64, autoLoopMessage(1, true));
      break;
    case "loop-roll":
      add(0, trackMessages(1, "/music/fixture-a.mp3", "Fixture A", "Emulator")[2] as OscMessage);
      add(20, playheadMessage(1, 0, 1, 124));
      add(60, osc("/Status/Deck/Loop/BeatLength", deckIndex(1), arg.f(0.5)));
      add(64, osc("/Status/Deck/Loop/LoopRollOn", deckIndex(1), arg.f(1)));
      add(160, osc("/Status/Deck/Loop/LoopRollOn", deckIndex(1), arg.f(0)));
      break;
    case "pitch-plus-8":
      add(0, trackMessages(1, "/music/fixture-a.mp3", "Fixture A", "Emulator")[2] as OscMessage);
      add(20, playheadMessage(1, 0, 1.08, 133.92));
      add(120, playheadMessage(1, 2.16, 1.08, 133.92));
      break;
    case "crossfader":
      add(0, trackMessages(1, "/music/fixture-a.mp3", "Fixture A", "Emulator")[2] as OscMessage);
      add(20, osc("/Status/Video/Mixer/Crossfader", arg.f(0)));
      add(60, playheadMessage(1, 0, 1, 124));
      add(120, osc("/Status/Video/Mixer/Crossfader", arg.f(1)));
      break;
    case "upfader":
      add(0, trackMessages(1, "/music/fixture-a.mp3", "Fixture A", "Emulator")[2] as OscMessage);
      add(20, osc("/Status/Video/Deck/Mixer/Upfader", deckIndex(1), arg.f(0)));
      add(60, playheadMessage(1, 0, 1, 124));
      add(120, osc("/Status/Video/Deck/Mixer/Upfader", deckIndex(1), arg.f(0.8)));
      break;
    case "two-decks":
      for (const step of seratoActionScript("load-deck-1")) add(step.atMs, step.message);
      for (const step of seratoActionScript("load-deck-2")) add(step.atMs + 40, step.message);
      add(140, playheadMessage(1, 4, 1, 124));
      add(160, playheadMessage(2, 2, 1, 126));
      add(200, osc("/Status/Video/Mixer/Crossfader", arg.f(0.25)));
      break;
    case "replace-track":
      add(0, trackMessages(1, "/music/fixture-a.mp3", "Fixture A", "Emulator")[2] as OscMessage);
      add(20, autoLoopMessage(1, true));
      add(24, osc("/Status/Deck/Loop/BeatLength", deckIndex(1), arg.f(4)));
      add(60, playheadMessage(1, 30, 1, 124));
      for (const [i, message] of trackMessages(1, "/music/fixture-c.mp3", "Fixture C", "Emulator").entries()) {
        add(120 + i * 4, message);
      }
      add(160, playheadMessage(1, 0, 0, 128));
      break;
    case "eject-deck-1":
      add(0, trackMessages(1, "/music/fixture-a.mp3", "Fixture A", "Emulator")[2] as OscMessage);
      add(20, playheadMessage(1, 0, 0, 124));
      add(80, osc("/Status/Deck/Song/Valid", deckIndex(1), arg.f(0)));
      break;
  }
  return steps.sort((a, b) => a.atMs - b.atMs);
}

/** The same script as wire frames, which is what fixtures store. */
export function frameScript(steps: readonly SeratoScriptStep[]): SeratoFrame[] {
  return steps.map((step) => ({ atMs: step.atMs, bytes: frameOsc(step.message) }));
}

export function framesForAction(action: SeratoAction): SeratoFrame[] {
  return frameScript(seratoActionScript(action));
}

export interface SeratoEmulatorOptions {
  port: number;
  host?: string;
  peerName?: string;
  peerUuid?: string;
  /** Malformed-frame source: a 16-byte nonce per challenge. */
  challenge?: Buffer;
}

/** One captured frame, as the peer sent or received it. */
export interface RecordedFrame {
  atMs: number;
  bytes: Buffer;
  direction: "sent" | "received";
}

/**
 * The Serato side of the Remote protocol over a real TCP socket. `handshake`
 * walks the documented exchange and reports what came back, so a test can
 * assert the challenge response and the subscription list instead of trusting
 * them.
 */
export class SeratoRemoteEmulator {
  private readonly options: SeratoEmulatorOptions;
  private socket: Socket | null = null;
  private readonly reader = new FrameReader();
  private readonly receivedMessages: OscMessage[] = [];
  private readonly recorded: RecordedFrame[] = [];
  private readonly waiters: {
    match: (message: OscMessage) => boolean;
    resolve: (message: OscMessage) => void;
    reject: (error: Error) => void;
    onTimeout: string;
  }[] = [];

  constructor(options: SeratoEmulatorOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const socket = connect({ host: this.options.host ?? "127.0.0.1", port: this.options.port }, () => resolve());
    socket.on("error", reject);
    socket.on("data", (chunk: Buffer) => {
      for (const message of this.reader.push(chunk)) {
        this.receivedMessages.push(message);
        this.recorded.push({ atMs: Date.now(), bytes: frameOsc(message), direction: "received" });
        for (const waiter of [...this.waiters]) {
          if (!waiter.match(message)) continue;
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    });
    this.socket = socket;
    await promise;
  }

  /** Peer side of the handshake; throws when the server never answers. */
  async handshake(): Promise<{ topics: string[]; digestBytes: number }> {
    const nonce = this.options.challenge ?? Buffer.from("autolight-nonce!", "utf8");
    this.send(osc("/StreamMgmt/Authorize/Request", arg.b(nonce)));
    const response = await this.awaitMessage("/StreamMgmt/Authorize/Response");
    const digest = response.args.find((a) => a.type === "b");
    if (!digest) throw new Error("Authorize response carried no digest blob");
    if (digest.value.length !== 16) throw new Error(`Authorize digest was ${digest.value.length} bytes, expected 16`);
    this.send(osc("/StreamMgmt/Pairing/Pair", arg.s(this.options.peerName ?? "SDJ @ emulator"), arg.s(this.options.peerUuid ?? "Serato DJ"), arg.i(0)));
    const pair = await this.awaitMessage("/StreamMgmt/Pairing/Pair");
    const active = pair.args.find((a) => a.type === "i");
    if (active?.value !== 1) throw new Error("server did not reply to Pair with isActive=1");
    const register = await this.awaitMessagePrefix("/Register/Status/");
    // The subscription burst ends with the mixer topic; waiting for it proves
    // every /Register/Status/... frame has arrived before we read them back.
    await this.awaitMessage("/Register/Status/Video/Mixer/Crossfader");
    const topics = [register, ...this.receivedMessages.filter((m) => m.address.startsWith("/Register/Status/")).map((m) => m.address)];
    return { topics: [...new Set(topics)], digestBytes: digest.value.length };
  }

  /** Send one framed message, recording it as peer traffic. */
  send(message: OscMessage): void {
    const bytes = frameOsc(message);
    this.recorded.push({ atMs: Date.now(), bytes, direction: "sent" });
    this.socket?.write(bytes);
  }

  /** Send a frame the protocol cannot decode, to exercise the reject path. */
  sendMalformedFrame(): void {
    const header = Buffer.from("/Status/Deck/Playhead\0\0\0,jjj", "utf8");
    const frame = Buffer.concat([header, Buffer.alloc(4), frameOsc(osc("/Ping")).subarray(-16)]);
    this.recorded.push({ atMs: Date.now(), bytes: frame, direction: "sent" });
    this.socket?.write(frame);
  }

  /** Play an action script with `speed` scaling the real delays. */
  async playAction(action: SeratoAction, speed = 4): Promise<void> {
    const steps = seratoActionScript(action);
    let previousAt = 0;
    for (const step of steps) {
      const waitMs = (step.atMs - previousAt) / speed;
      previousAt = step.atMs;
      if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      this.send(step.message);
    }
  }

  /** Frames the peer sent, in wire form, with arrival timestamps. */
  capturedFrames(): SeratoFrame[] {
    return this.recorded.filter((r) => r.direction === "sent").map((r) => ({ atMs: r.atMs, bytes: r.bytes }));
  }

  receivedAddresses(): string[] {
    return this.receivedMessages.map((m) => m.address);
  }

  async close(): Promise<void> {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    const { promise, resolve } = Promise.withResolvers<void>();
    socket.once("close", () => resolve());
    socket.end();
    await promise;
  }

  private awaitMessage(address: string): Promise<OscMessage> {
    return this.awaitPredicate((message) => message.address === address, `no ${address} from server`);
  }

  private async awaitMessagePrefix(prefix: string): Promise<string> {
    const message = await this.awaitPredicate((m) => m.address.startsWith(prefix), `no ${prefix}* from server`);
    return message.address;
  }

  private awaitPredicate(match: (message: OscMessage) => boolean, onTimeout: string): Promise<OscMessage> {
    const existing = this.receivedMessages.find(match);
    if (existing) return Promise.resolve(existing);
    const { promise, resolve, reject } = Promise.withResolvers<OscMessage>();
    const waiter = { match, resolve, reject, onTimeout };
    this.waiters.push(waiter);
    setTimeout(() => {
      const index = this.waiters.indexOf(waiter);
      if (index === -1) return;
      this.waiters.splice(index, 1);
      reject(new Error(onTimeout));
    }, 4000);
    return promise;
  }
}

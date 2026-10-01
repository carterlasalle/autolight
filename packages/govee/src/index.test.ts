import { describe, expect, it } from "vitest";
import { createSocket } from "node:dgram";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  blackoutPayload, whiteHitPayload, latencyBeats, encodeRaw, decodeRaw, envelope,
  arm, paint, paintZoned, parseStatus,
  qualificationKey, needsRequalification, LatestStream, DeviceManager,
  parseScanReply, turnCommand, brightnessCommand, colorCommand,
  devStatusCommand, parseDevStatus, collapseToSingleColor,
  PacingStream, WALL_SCHEDULER, NativeStreamEngine, SocketTransport, ToolkitEngine,
  createEngineSelector, ToolkitLoadFailure,
  type ToolkitStreamFactory, type Scheduler, type TimerHandle, type StreamTransport,
  type StreamOptions, type BindingModule, type BindingSdk, type BindingDevice,
  type BindingDeviceHandle, type BindingDeviceStatus, type BindingStream,
} from "./index.js";

function fixtureDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "protocol-fixtures", "govee", "razer");
}

function hexOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

// Zone colours as the simulator reports them, for rendered-state comparisons.
function zonesOf(frame: Uint8Array): string {
  const zones: Array<[number, number, number]> = [];
  for (let i = 0; i + 2 < frame.length; i += 3) zones.push([frame[i]!, frame[i + 1]!, frame[i + 2]!]);
  return JSON.stringify(zones);
}

describe("govee", () => {
  it("parses official scan replies", () => {
    const reply = parseScanReply({ msg: { cmd: "scan", data: { ip: "192.168.1.23", device: "1F:80:C5:32:32:36:72:4E", sku: "H6076", bleVersionHard: "3.01.01", bleVersionSoft: "1.03.01", wifiVersionHard: "1.00.10", wifiVersionSoft: "1.02.03" } } });
    expect(reply?.ip).toBe("192.168.1.23");
    expect(reply?.sku).toBe("H6076");
    expect(parseScanReply({ msg: { cmd: "scan", data: { ip: "x" } } })).toBeNull();
  });
  it("builds the 4 official control commands", () => {
    expect(JSON.parse(turnCommand(true)).msg).toMatchObject({ cmd: "turn", data: { value: 1 } });
    expect(JSON.parse(brightnessCommand(20)).msg).toMatchObject({ cmd: "brightness", data: { value: 20 } });
    expect(JSON.parse(brightnessCommand(999)).msg.data.value).toBe(100);
    const color = JSON.parse(colorCommand(0, 12, 8)).msg;
    expect(color).toMatchObject({ cmd: "colorwc", data: { color: { r: 0, g: 12, b: 8 }, colorTemInKelvin: 0 } });
    expect(JSON.parse(devStatusCommand()).msg.cmd).toBe("devStatus");
  });
  it("parses devStatus replies", () => {
    const s = parseDevStatus({ msg: { cmd: "devStatus", data: { onOff: 1, brightness: 100, color: { r: 255, g: 0, b: 0 }, colorTemInKelvin: 7200 } } });
    expect(s).toMatchObject({ onOff: true, brightness: 100 });
    expect(parseDevStatus({})).toBeNull();
  });
  it("single-zone fallback picks the middle color (T-GOV-10 verified fallback, not the default path)", () => {
    // The default path is the segmented razer paint (B0/B4) proven byte-exact above.
    // collapseToSingleColor survives only for the verified single-zone fallback until T-GOV-10 removes it.
    expect(collapseToSingleColor(new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]))).toEqual([0, 255, 0]);
    expect(collapseToSingleColor(new Uint8Array([]))).toEqual([0, 0, 0]);
  });
  it("blackout is zeros, not power-off", () => {
    expect([...blackoutPayload(2)]).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("white hit scales in linear light", () => {
    expect([...whiteHitPayload(1, 1)]).toEqual([255, 255, 255]);
    const dim = whiteHitPayload(1, 0.3);
    expect(dim[0]!).toBeGreaterThan(0);
    expect(dim[0]!).toBeLessThan(255);
  });
  it("computes latency offset in beats", () => {
    expect(latencyBeats(500, 120)).toBeCloseTo(1);
    expect(latencyBeats(0, 120)).toBe(0);
  });
  it("keys qualification on id+sku+firmware", () => {
    const id = { hardwareId: "h", sku: "H6076", firmwareVersion: "1", ip: null };
    expect(qualificationKey(id)).toContain("H6076");
    expect(needsRequalification("1", "2")).toBe(true);
    expect(needsRequalification("1", "1")).toBe(false);
  });
  it("stream keeps newest only", () => {
    const sent: Uint8Array[] = [];
    const s = new LatestStream((f) => sent.push(f));
    s.setAll(new Uint8Array([1])); s.setAll(new Uint8Array([2])); s.flush();
    expect(sent).toEqual([new Uint8Array([2])]);
  });
  it("backs off per-device fps and reconnects clean", () => {
    const m = new DeviceManager();
    const dev = m.discover({ hardwareId: "h", sku: "H6076", firmwareVersion: "1", ip: "10.0.0.2" }, 30);
    m.backoff("h");
    expect(m.get("h")!.fps).toBe(15);
    expect(m.get("h")!.health).toBe("degraded");
    m.markOffline("h");
    expect(m.get("h")!.health).toBe("offline");
    m.discover({ hardwareId: "h", sku: "H6076", firmwareVersion: "1", ip: "10.0.0.2" }, dev.fps);
    expect(m.get("h")!.health).toBe("online");
  });
  it("closed streams drop pending frames instead of sending", async () => {
    const sent: Uint8Array[] = [];
    const factory: ToolkitStreamFactory = {
      openStream: async (_ip, _zones) => new LatestStream((f) => { sent.push(f); }),
    };
    const stream = await factory.openStream("10.0.0.2", 14);
    stream.setAll(new Uint8Array([1, 2, 3]));
    stream.close();
    stream.setAll(new Uint8Array([4, 5, 6]));
    stream.flush();
    expect(sent.length).toBe(0);
    expect(sent).toEqual([]);
  });
  it("encodes the arm golden vector byte-exact (bb 00 01 b1 01 0a)", () => {
    expect(hexOf(arm(true))).toBe("bb0001b1010a");
    expect(hexOf(arm(false))).toBe("bb0001b1000b");
  });
  it("re-encodes every razer fixture byte-exact", () => {
    const dir = fixtureDir();
    const names = readdirSync(dir).filter((n) => n.endsWith(".json") && n !== "status-armed.json");
    expect(names.length).toBeGreaterThanOrEqual(18);
    for (const name of names) {
      const vec = JSON.parse(readFileSync(join(dir, name), "utf8")) as { hex: string; base64: string };
      const raw = new Uint8Array(Buffer.from(vec.base64, "base64"));
      expect(hexOf(raw)).toBe(vec.hex);
      const decoded = decodeRaw(raw);
      expect(decoded).not.toBeNull();
      expect(hexOf(encodeRaw(decoded!.opcode, decoded!.payload))).toBe(vec.hex);
    }
    const status = JSON.parse(readFileSync(join(dir, "status-armed.json"), "utf8")) as {
      json: { msg: { cmd: string; data: { onOff: number; brightness: number; pt: string } } };
    };
    const parsed = parseStatus(status.json);
    expect(parsed).toMatchObject({ onOff: true, brightness: 80, armed: true });
  });
  it("round-trips decode(encode(x)) with checksum validation", () => {
    let seed = 0x12345678;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed & 0xff;
    };
    for (let round = 0; round < 200; round++) {
      const len = next() % 64;
      const payload = new Uint8Array(len);
      for (let i = 0; i < len; i++) payload[i] = next();
      const opcode = [0xb0, 0xb1, 0xb2, 0xb4][round % 4]!;
      const frame = encodeRaw(opcode, payload);
      const decoded = decodeRaw(frame);
      expect(decoded?.opcode).toBe(opcode);
      expect(decoded ? [...decoded.payload] : []).toEqual([...payload]);
      const corrupt = new Uint8Array(frame);
      corrupt[corrupt.length - 1]! ^= 0xff;
      expect(decodeRaw(corrupt)).toBeNull();
    }
    const colors = new Uint8Array([255, 0, 0, 0, 255, 0]);
    expect(hexOf(paint(colors, 0))).toBe(hexOf(encodeRaw(0xb0, new Uint8Array([0, 2, 255, 0, 0, 0, 255, 0]))));
    expect(() => paint(new Uint8Array([1, 2]), 0)).toThrow(RangeError);
    const zoned = paintZoned([{ r: 1, g: 2, b: 3, zone: 4 }], 1);
    expect(decodeRaw(zoned)?.opcode).toBe(0xb4);
    const env = JSON.parse(envelope(arm(true))) as { msg: { cmd: string; data: { pt: string } } };
    expect(env.msg.cmd).toBe("razer");
    expect(hexOf(new Uint8Array(Buffer.from(env.msg.data.pt, "base64")))).toBe("bb0001b1010a");
    expect(parseStatus({ msg: { cmd: "status", data: { onOff: 1, brightness: 50, pt: "!!!" } } })?.armed).toBe(false);
    expect(parseStatus({ msg: { cmd: "devStatus", data: {} } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-GOV-01..03: engine wrappers, the DS-02 switch, and the parity proof.
// ---------------------------------------------------------------------------

interface FakeTask { at: number; fn: () => void; every: number | null }

// Deterministic scheduler: time moves only when the test says so, so pacing,
// supersession and missed ticks are exact rather than wall-clock dependent.
class FakeClock implements Scheduler {
  private current = 0;
  private seq = 0;
  private readonly tasks = new Map<number, FakeTask>();
  now(): number { return this.current; }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const handle = ++this.seq;
    this.tasks.set(handle, { at: this.current + Math.max(0, ms), fn, every: null });
    return handle;
  }
  setInterval(fn: () => void, ms: number): TimerHandle {
    const handle = ++this.seq;
    const every = Math.max(1, ms);
    this.tasks.set(handle, { at: this.current + every, fn, every });
    return handle;
  }
  clearTimeout(handle: TimerHandle): void { if (typeof handle === "number") this.tasks.delete(handle); }
  clearInterval(handle: TimerHandle): void { if (typeof handle === "number") this.tasks.delete(handle); }
  // Runs every task due inside the window, in time order, never rewinding time.
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      let earliest: [number, FakeTask] | null = null;
      for (const entry of this.tasks) {
        if (entry[1].at > target) continue;
        if (earliest === null || entry[1].at < earliest[1].at) earliest = entry;
      }
      if (earliest === null) break;
      const [handle, task] = earliest;
      this.current = Math.max(this.current, task.at);
      if (task.every === null) this.tasks.delete(handle);
      else task.at = this.current + task.every;
      task.fn();
    }
    this.current = Math.max(this.current, target);
  }
  // Time passes with no loop run (backgrounded app, long GC pause).
  stall(ms: number): void { this.current += ms; }
}

class RecordingSender implements StreamTransport {
  readonly datagrams: string[] = [];
  push(text: string): void { this.datagrams.push(text); }
  sendRaw(_deviceId: string, raw: Uint8Array): void { this.datagrams.push(envelope(raw)); }
  sendJson(_deviceId: string, text: string): void { this.datagrams.push(text); }
}

// Our own envelope shape, generated in this process, is the input here.
function razerHex(text: string): string {
  const env = JSON.parse(text) as { msg: { cmd: string; data: { pt: string } } };
  if (env.msg.cmd !== "razer") throw new Error(`not a razer datagram: ${text}`);
  return hexOf(new Uint8Array(Buffer.from(env.msg.data.pt, "base64")));
}

// Addon-shaped stub: arms inside openStream, settles, then emits on a fixed
// interval with newest-wins and no re-send of an unchanged frame. That is the
// binding behaviour documented in govee-toolkit's stream module and
// docs/protocol/lan.md; the real addon is absent on this machine, so the stub
// stands in for its side of the parity proof.
class StubBindingStream implements BindingStream {
  readonly zones: number;
  readonly rateHz: number;
  readonly error: string | null = null;
  framesSent = 0;
  framesSuperseded = 0;
  private readonly sink: (text: string) => void;
  private readonly gradient: number;
  private pending: Uint8Array | null = null;
  private lastHex: string | null = null;
  private timer: TimerHandle | null = null;

  constructor(
    opts: { zones: number; rateHz: number; gradient: number; armSettleMs: number },
    sink: (text: string) => void,
    private readonly clock: Scheduler,
  ) {
    this.zones = opts.zones;
    this.rateHz = opts.rateHz;
    this.gradient = opts.gradient;
    this.sink = sink;
    const intervalMs = Math.max(1, Math.round(1000 / Math.max(1, opts.rateHz)));
    sink(envelope(arm(true)));
    this.clock.setTimeout(() => {
      this.timer = this.clock.setInterval(() => { this.emit(); }, intervalMs);
      this.emit();
    }, Math.max(0, opts.armSettleMs));
  }

  private emit(): void {
    if (this.pending === null) return;
    const frame = this.pending;
    this.pending = null;
    const hex = hexOf(frame);
    if (hex === this.lastHex) return;
    this.lastHex = hex;
    this.framesSent += 1;
    this.sink(envelope(paint(frame, this.gradient)));
  }

  setAll(colors: Uint8Array | Array<[number, number, number]>): void {
    const frame = colors instanceof Uint8Array ? colors : new Uint8Array(colors.flat());
    if (this.pending !== null) this.framesSuperseded += 1;
    this.pending = frame.slice();
  }

  async close(): Promise<void> {
    if (this.timer !== null) { this.clock.clearInterval(this.timer); this.timer = null; }
    this.pending = null;
    this.sink(envelope(arm(false)));
  }
}

interface StubBindingOptions {
  clock: Scheduler;
  sink: (text: string) => void;
  armSettleMs?: number;
  failFor?: string[];
  devices?: BindingDevice[];
}

class StubBinding implements BindingModule {
  readonly VERSION = "0.5.0";
  readonly CORE_VERSION = "0.14.0";
  readonly __napiBindingTarget = "native";
  readonly opened: string[] = [];
  private readonly clock: Scheduler;
  private readonly sink: (text: string) => void;
  private readonly armSettleMs: number;
  private readonly failFor: Set<string>;
  private readonly devices: BindingDevice[];

  constructor(opts: StubBindingOptions) {
    this.clock = opts.clock;
    this.sink = opts.sink;
    this.armSettleMs = opts.armSettleMs ?? 20;
    this.failFor = new Set(opts.failFor ?? []);
    this.devices = opts.devices ?? [{ id: "SIM:01", sku: "H6076", modes: ["lan"] }];
  }

  async start(): Promise<BindingSdk> {
    return {
      scan: async () => this.devices,
      devices: () => this.devices,
      device: (target: string) => this.handle(target),
      close: async () => undefined,
    };
  }

  private handle(id: string): BindingDeviceHandle {
    return {
      id,
      modes: ["lan"],
      health: () => ({ state: "ok", failures: 0, available: true }),
      openStream: async (resolution, rate, gradient) => {
        if (this.failFor.has(id)) throw new Error(`device ${id} refused the segment channel`);
        this.opened.push(id);
        const zones = typeof resolution === "number" ? resolution : 14;
        const rateHz = typeof rate === "number" ? rate : 40;
        return new StubBindingStream(
          { zones, rateHz, gradient: gradient === true ? 1 : 0, armSettleMs: this.armSettleMs },
          this.sink,
          this.clock,
        );
      },
      identify: async () => undefined,
      segment: async () => undefined,
      status: async (): Promise<BindingDeviceStatus> => ({ id, on: true, brightness: 100, raw: {} }),
    };
  }
}

const PARITY_OPTS: StreamOptions = { resolution: 4, rateHz: 20, gradient: 0, armSettleMs: 20 };
const PARITY_FRAMES = {
  a: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 12, 34, 56]),
  b: new Uint8Array([0, 0, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90]),
  c: new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 2, 3]),
  d: new Uint8Array([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]),
  e: new Uint8Array([5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8]),
};

// One scripted frame sequence per engine, on separate clocks so each run is
// independent: repeat, supersede, then continue. Both must send the same bytes.
function driveScript(stream: { setAll(frame: Uint8Array): void }, clock: FakeClock): void {
  stream.setAll(PARITY_FRAMES.a);
  clock.advance(50);
  stream.setAll(PARITY_FRAMES.b);
  clock.advance(50);
  stream.setAll(PARITY_FRAMES.b); // unchanged: not re-sent
  clock.advance(50);
  stream.setAll(PARITY_FRAMES.c);
  stream.setAll(PARITY_FRAMES.d); // superseded by d
  clock.advance(50);
  stream.setAll(PARITY_FRAMES.e);
  clock.advance(50);
}

interface SimLike {
  start(port?: number): Promise<number>;
  stop(): Promise<void>;
  readonly controlPort: number;
  readonly armedState: boolean;
  readonly rendered: Array<[number, number, number]>;
  readonly metrics: { datagrams: number; paintsApplied: number; paintsStuttered: number };
}

type SimCtor = new (
  profile: { device: string; sku: string; zones: number; armSettleMs?: number },
  faults?: Record<string, unknown>,
) => SimLike;

// A static import cannot work here (test-case exception): the simulator's
// built module may be absent depending on build order, and a static import
// would fail this whole file at load time instead of skipping one test. The
// runtime import keeps @autolight/govee free of a compile-time dependency.
const SIM_MODULE = "@autolight/simulator/dist/govee-lan.js";

async function loadSimulator(): Promise<SimCtor | null> {
  try {
    const mod: unknown = await import(/* @vite-ignore */ SIM_MODULE);
    if (typeof mod !== "object" || mod === null) return null;
    const ctor = "GoveeLanSim" in mod ? mod.GoveeLanSim : undefined;
    // Checked as a function; the simulator's constructor shape is documented.
    return typeof ctor === "function" ? (ctor as SimCtor) : null;
  } catch (err) {
    // Loud, not silent: the simulator tests skip and say why.
    console.warn("govee: LAN simulator unavailable, skipping simulator parity", err);
    return null;
  }
}

const SimClass = await loadSimulator();

function udpSink(port: number): { send: (text: string) => void; close: () => void } {
  const sock = createSocket("udp4");
  return {
    send: (text: string) => { sock.send(text, port, "127.0.0.1", () => undefined); },
    close: () => { sock.close(); },
  };
}

describe("govee engines (T-GOV-01..03)", () => {
  it("parity: toolkit and native-ts send the same datagrams and hold the same counters", async () => {
    const nativeClock = new FakeClock();
    const nativeSink = new RecordingSender();
    const native = new NativeStreamEngine({ transport: nativeSink, clock: nativeClock, armSettleMs: 20 });
    const nativeStream = await native.openStream("SIM:01", PARITY_OPTS);
    driveScript(nativeStream, nativeClock);
    nativeStream.close();

    const toolkitClock = new FakeClock();
    const toolkitSink = new RecordingSender();
    const binding = new StubBinding({ clock: toolkitClock, sink: (text) => toolkitSink.push(text), armSettleMs: 20 });
    const toolkit = new ToolkitEngine({ loader: async () => binding });
    const toolkitStream = await toolkit.openStream("SIM:01", PARITY_OPTS);
    driveScript(toolkitStream, toolkitClock);
    toolkitStream.close();

    // Same frame sequence, same content, same order (timing differs by design).
    expect(toolkitSink.datagrams).toEqual(nativeSink.datagrams);
    const hex = nativeSink.datagrams.map(razerHex);
    expect(hex[0]).toBe(hexOf(arm(true)));
    expect(hex[hex.length - 1]).toBe(hexOf(arm(false)));
    expect(hex).toEqual([
      hexOf(arm(true)),
      hexOf(paint(PARITY_FRAMES.a, 0)),
      hexOf(paint(PARITY_FRAMES.b, 0)),
      hexOf(paint(PARITY_FRAMES.d, 0)),
      hexOf(paint(PARITY_FRAMES.e, 0)),
      hexOf(arm(false)),
    ]);

    const nativeMetrics = native.metrics("SIM:01")[0]!;
    const toolkitMetrics = toolkit.metrics("SIM:01")[0]!;
    expect(nativeMetrics).toMatchObject({
      engine: "native-ts", framesRequested: 6, framesSent: 4, framesSuperseded: 1,
    });
    expect(toolkitMetrics).toMatchObject({
      engine: "toolkit", framesRequested: 6, framesSent: 4, framesSuperseded: 1,
    });
  });

  it("skips missed ticks instead of bursting them", () => {
    const clock = new FakeClock();
    const sink = new RecordingSender();
    const stream = new PacingStream("SIM:01", { resolution: 4, rateHz: 10, gradient: 0, armSettleMs: 0 }, sink, clock);
    clock.advance(0); // settle 0: the loop starts now
    stream.setAll(PARITY_FRAMES.a);
    clock.advance(100);
    expect(stream.framesSent).toBe(1);
    stream.setAll(PARITY_FRAMES.b);
    clock.stall(250); // 2.5 intervals pass with no loop run
    clock.advance(0);
    // One emit, not a burst of three, and the gap is counted.
    expect(stream.framesSent).toBe(2);
    expect(stream.missedTicks).toBe(1);
    stream.close();
  });

  it("auto falls back to native-ts with the typed load reason", async () => {
    const loadError = new Error("dlopen(govee_toolkit.node): image not found");
    const selector = await createEngineSelector({
      mode: "auto",
      toolkit: new ToolkitEngine({ loader: async () => { throw loadError; } }),
      native: new NativeStreamEngine({ transport: new RecordingSender(), clock: new FakeClock() }),
    });
    expect(selector.currentKind()).toBe("native-ts");
    expect(selector.report().reason).toContain("dlopen(govee_toolkit.node)");
    expect(selector.decision("SIM:01").reason).toContain("toolkit addon failed to load");
    expect(selector.summary().mode).toBe("auto");
  });

  it("toolkit mode reports the load failure instead of downgrading silently", async () => {
    const selector = createEngineSelector({
      mode: "toolkit",
      toolkit: new ToolkitEngine({ loader: async () => { throw new Error("no artifact for darwin-x64"); } }),
      native: new NativeStreamEngine({ transport: new RecordingSender(), clock: new FakeClock() }),
    });
    await expect(selector).rejects.toBeInstanceOf(ToolkitLoadFailure);
    await expect(selector).rejects.toThrow(/no artifact for darwin-x64/);
  });

  it("auto falls back per device when its toolkit stream reports an error class", async () => {
    const clock = new FakeClock();
    const toolkitSink = new RecordingSender();
    const binding = new StubBinding({ clock, sink: (text) => toolkitSink.push(text), failFor: ["BAD:01"] });
    const toolkit = new ToolkitEngine({ loader: async () => binding });
    const native = new NativeStreamEngine({ transport: new RecordingSender(), clock, armSettleMs: 20 });
    const selector = await createEngineSelector({ mode: "auto", toolkit, native });

    await expect(selector.openStream("BAD:01", PARITY_OPTS)).resolves.toBeDefined();
    expect(selector.decision("BAD:01").engine).toBe("native-ts");
    expect(selector.decision("BAD:01").reason).toContain("toolkit stream error");
    expect(selector.decision("BAD:01").reason).toContain("refused the segment channel");
    // The healthy device keeps the toolkit.
    await selector.openStream("SIM:01", PARITY_OPTS);
    expect(selector.decision("SIM:01")).toEqual({ engine: "toolkit", reason: null });
    expect(binding.opened).toEqual(["SIM:01"]);
  });

  it("a mid-show flip costs one arm-settle gap per device", async () => {
    const clock = new FakeClock();
    const toolkitSink = new RecordingSender();
    const nativeSink = new RecordingSender();
    const binding = new StubBinding({ clock, sink: (text) => toolkitSink.push(text), armSettleMs: 20 });
    const selector = await createEngineSelector({
      mode: "auto",
      toolkit: new ToolkitEngine({ loader: async () => binding }),
      native: new NativeStreamEngine({ transport: nativeSink, clock, armSettleMs: 20 }),
    });

    const first = await selector.openStream("SIM:01", PARITY_OPTS);
    first.setAll(PARITY_FRAMES.a);
    clock.advance(50);
    expect(razerHex(toolkitSink.datagrams[1]!)).toBe(hexOf(paint(PARITY_FRAMES.a, 0)));

    // The flip: the show host observes the toolkit error, disarms and reopens
    // on the native engine.
    selector.noteFallback("SIM:01", "toolkit stream error: channel closed by the host");
    first.close();
    const second = await selector.openStream("SIM:01", PARITY_OPTS);

    expect(toolkitSink.datagrams.map(razerHex)).toEqual([
      hexOf(arm(true)), hexOf(paint(PARITY_FRAMES.a, 0)), hexOf(arm(false)),
    ]);
    // Arm is on the wire immediately, and no paint before the settle elapses.
    expect(nativeSink.datagrams.map(razerHex)).toEqual([hexOf(arm(true))]);
    clock.advance(19);
    expect(nativeSink.datagrams.length).toBe(1);
    clock.advance(1);
    second.setAll(PARITY_FRAMES.e);
    clock.advance(50);
    expect(nativeSink.datagrams.map(razerHex)).toEqual([
      hexOf(arm(true)), hexOf(paint(PARITY_FRAMES.e, 0)),
    ]);
    expect(selector.decision("SIM:01").engine).toBe("native-ts");
  });

  it.skipIf(SimClass === null)("both engines against the LAN simulator paint identically", async () => {
    if (SimClass === null) throw new Error("simulator build missing");
    const PROFILE = { device: "SIM:01", sku: "H6076", zones: 4, armSettleMs: 5 };
    const FRAMES = [
      new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]),
      new Uint8Array([0, 255, 0, 0, 0, 255, 255, 0, 0, 0, 0, 0]),
      new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]),
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    ];
    // Real timers cannot be faked here: the frames travel real UDP through the
    // engine's own interval, so each step waits for the device to report the
    // paint (bounded, condition driven, never a guessed duration).
    const waitFor = async (predicate: () => boolean, timeoutMs: number): Promise<void> => {
      const deadline = Date.now() + timeoutMs;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error("the simulator never reported the condition");
        await new Promise<void>((resolve) => { setTimeout(() => resolve(), 5); });
      }
    };
    interface SimRun { paints: number; rendered: string; disarmed: boolean }
    const drive = async (engine: NativeStreamEngine | ToolkitEngine, sim: SimLike): Promise<SimRun> => {
      const stream = await engine.openStream("SIM:01", { resolution: 4, rateHz: 20, gradient: 0, armSettleMs: 30 });
      for (let i = 0; i < FRAMES.length; i++) {
        stream.setAll(FRAMES[i]!);
        // Newest-wins would replace a frame before it leaves, so wait for this
        // one to be applied before queueing the next.
        await waitFor(() => sim.metrics.paintsApplied >= i + 1, 1000);
      }
      const run: SimRun = { paints: sim.metrics.paintsApplied, rendered: JSON.stringify(sim.rendered), disarmed: false };
      stream.close();
      await waitFor(() => !sim.armedState, 1000); // the disarm reached the device
      run.disarmed = !sim.armedState;
      return run;
    };

    const nativeSim = new SimClass(PROFILE, { rateCeiling: true, armSettle: true });
    const nativePort = await nativeSim.start(0);
    const sender = new SocketTransport(() => "127.0.0.1", nativePort);
    const native = new NativeStreamEngine({ transport: sender });
    const nativeRun = await drive(native, nativeSim);
    expect(sender.openSockets).toBe(1); // one socket for every frame, not per send
    await native.close();
    sender.close(); // an injected transport is closed by its owner, not the engine
    expect(sender.openSockets).toBe(0);
    await nativeSim.stop();

    const toolkitSim = new SimClass(PROFILE, { rateCeiling: true, armSettle: true });
    const toolkitPort = await toolkitSim.start(0);
    const sink = udpSink(toolkitPort);
    const binding = new StubBinding({ clock: WALL_SCHEDULER, sink: sink.send, armSettleMs: 30 });
    const toolkit = new ToolkitEngine({ loader: async () => binding });
    const toolkitRun = await drive(toolkit, toolkitSim);
    sink.close();
    await toolkit.close();
    await toolkitSim.stop();

    expect(toolkitRun).toEqual(nativeRun);
    expect(nativeRun.paints).toBe(FRAMES.length);
    expect(nativeRun.disarmed).toBe(true); // disarm on close ended the channel
    expect(nativeRun.rendered).toBe(zonesOf(FRAMES[FRAMES.length - 1]!));
  });
});

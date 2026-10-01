// FLX4 MIDI input backends (T-FLX-01, DS-13) and non-exclusive observation.
//
// The controller is observed without an exclusive open. macOS CoreMIDI lets
// several clients read one source and Windows MIDI Services is multi-client,
// so AutoLight can read the FLX4 while Rekordbox plays through it. Windows
// WinMM is single-client: when another application holds the input, opening it
// fails, and the service reports UNAVAILABLE_ON_THIS_DEVICE with the remedy
// instead of pretending the controller is broken (the failure itself is
// proven on hardware in HW-FLX-01; the reporting path is tested by injecting
// the driver's open error).
//
// Backends behind `flx4.backend` (DS-13): `native` (@julusian/midi, the
// lowest-latency main-process path), `windows-midi-services` (multi-client,
// Windows only), `webmidi` (the hidden audio window, T-AUD-01), and `auto`
// (native, then Windows MIDI Services, then Web MIDI; every attempt is
// reported). Ports are matched by name against `flx4.portMatch`, the port list
// is polled every `flx4.hotplugPollMs` for hotplug and reconnect, and every
// message is stamped with a monotonic `Ns` at receipt and kept in a bounded
// ring with a drop counter (S26).

import { Flx4Decoder, type Flx4Event } from "./map.js";

export type Flx4BackendName = "native" | "windows-midi-services" | "webmidi";
export type Flx4BackendMode = "auto" | Flx4BackendName;

/** DS-13 order for auto. */
export const AUTO_BACKEND_ORDER: readonly Flx4BackendName[] = ["native", "windows-midi-services", "webmidi"];

export interface Flx4PortInfo {
  id: string;
  name: string;
}

export interface Flx4MidiInput {
  readonly port: Flx4PortInfo;
  close(): void;
}

export interface Flx4DriverProbe {
  ok: boolean;
  reason: string;
}

/**
 * One backend. `open` is always a shared, non-exclusive read; there is no
 * exclusive option, and the open of a single-client driver on Windows can be
 * refused while another application holds the port (that refusal is reported,
 * never retried in a loop).
 */
export interface Flx4MidiDriver {
  readonly name: Flx4BackendName;
  /** `shared` reads alongside other clients; `single-client` is WinMM. */
  readonly sharing: "shared" | "single-client";
  probe(): Promise<Flx4DriverProbe>;
  listPorts(): Promise<Flx4PortInfo[]>;
  open(port: Flx4PortInfo, onMessage: (bytes: readonly number[]) => void): Promise<Flx4MidiInput>;
}

export type Flx4ConnectionState =
  | "searching"
  | "connected"
  | "lost"
  | "unavailable-on-this-device"
  | "failed";

export interface Flx4BackendAttempt {
  backend: Flx4BackendName;
  ok: boolean;
  reason: string;
}

export interface Flx4ControllerStatus {
  mode: Flx4BackendMode;
  backend: Flx4BackendName | null;
  connection: Flx4ConnectionState;
  portName: string | null;
  attempts: Flx4BackendAttempt[];
  lastMessageAtNs: bigint | null;
  /** Age of the last message against the service clock; null before the first. */
  lastMessageAgeMs: number | null;
  messagesReceived: number;
  messagesDropped: number;
  unknownMessages: number;
  reason: string | null;
  remedy: string | null;
  portMatch: string;
  hotplugPollMs: number;
}

export interface Flx4TimedMessage {
  bytes: readonly [number, number, number];
  receivedAtNs: bigint;
}

/** Bounded ring for received messages; the oldest entry is dropped first. */
export class Flx4MessageRing {
  private readonly items: Flx4TimedMessage[] = [];
  private readonly capacity: number;
  private droppedCount = 0;

  constructor(capacity = 512) {
    this.capacity = Math.max(1, capacity);
  }

  push(message: Flx4TimedMessage): void {
    this.items.push(message);
    if (this.items.length > this.capacity) {
      this.items.shift();
      this.droppedCount += 1;
    }
  }

  recent(limit = 32): Flx4TimedMessage[] {
    return this.items.slice(-limit);
  }

  get dropped(): number {
    return this.droppedCount;
  }
}

export interface Flx4IntervalScheduler {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const defaultScheduler: Flx4IntervalScheduler = {
  setInterval(fn, ms) {
    return globalThis.setInterval(fn, ms);
  },
  clearInterval(handle) {
    // The DOM lib types the browser handle; Node's Timeout is opaque here.
    const id = handle as number;
    globalThis.clearInterval(id);
  },
};

export interface Flx4ServiceOptions {
  mode?: Flx4BackendMode;
  /** flx4.portMatch; default "DDJ-FLX4". */
  portMatch?: string;
  /** flx4.hotplugPollMs; default 2000. */
  hotplugPollMs?: number;
  ringCapacity?: number;
  nowNs?: () => bigint;
  /** Driver overrides for tests and platform wiring; platform defaults fill the rest. */
  drivers?: Partial<Record<Flx4BackendName, Flx4MidiDriver>>;
  /** Platform the single-client rules apply to; defaults to the running platform. */
  platform?: NodeJS.Platform;
  scheduler?: Flx4IntervalScheduler;
  /** Latest decoded events kept for the setup live control tester. */
  eventCapacity?: number;
}

export const DEFAULT_PORT_MATCH = "DDJ-FLX4";
export const DEFAULT_HOTPLUG_POLL_MS = 2000;

const WINDOWS_HELD_REMEDY =
  "Rekordbox is holding the FLX4 input; install Windows MIDI Services or use a Rekordbox source that does not need the controller";

export class Flx4ControllerService {
  private readonly mode: Flx4BackendMode;
  private readonly portMatch: string;
  private readonly hotplugPollMs: number;
  private readonly eventCapacity: number;
  private readonly drivers: Partial<Record<Flx4BackendName, Flx4MidiDriver>>;
  private readonly platform: NodeJS.Platform;
  private readonly scheduler: Flx4IntervalScheduler;
  private readonly nowNs: () => bigint;
  private readonly ring: Flx4MessageRing;
  private readonly decoder = new Flx4Decoder();
  private readonly events: Flx4Event[] = [];
  private readonly eventListeners = new Set<(event: Flx4Event) => void>();
  private readonly statusListeners = new Set<(status: Flx4ControllerStatus) => void>();
  private driver: Flx4MidiDriver | null = null;
  private input: Flx4MidiInput | null = null;
  private timer: unknown = null;
  private attempts: Flx4BackendAttempt[] = [];
  private connection: Flx4ConnectionState = "searching";
  private reason: string | null = null;
  private remedy: string | null = null;
  private lastMessageAtNs: bigint | null = null;
  private messagesReceived = 0;

  constructor(opts: Flx4ServiceOptions = {}) {
    this.mode = opts.mode ?? "auto";
    this.portMatch = opts.portMatch ?? DEFAULT_PORT_MATCH;
    this.hotplugPollMs = opts.hotplugPollMs ?? DEFAULT_HOTPLUG_POLL_MS;
    this.eventCapacity = opts.eventCapacity ?? 128;
    this.drivers = opts.drivers ?? {};
    this.platform = opts.platform ?? process.platform;
    this.scheduler = opts.scheduler ?? defaultScheduler;
    this.nowNs = opts.nowNs ?? (() => process.hrtime.bigint());
    this.ring = new Flx4MessageRing(opts.ringCapacity ?? 512);
  }

  /** Probes the backends in DS-13 order, opens the first matching port, arms the hotplug poll. */
  async start(): Promise<Flx4ControllerStatus> {
    await this.selectAndOpen();
    if (this.timer === null) {
      this.timer = this.scheduler.setInterval(() => {
        void this.poll();
      }, this.hotplugPollMs);
    }
    return this.status();
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      this.scheduler.clearInterval(this.timer);
      this.timer = null;
    }
    this.closeInput();
    this.connection = "searching";
    this.reason = null;
    this.remedy = null;
  }

  /** One hotplug pass: closes a vanished port, reconnects a returning one. */
  async poll(): Promise<void> {
    if (this.driver !== null && this.input !== null) {
      const ports = await this.driver.listPorts().catch(() => [] as Flx4PortInfo[]);
      if (ports.some((port) => port.id === this.input?.port.id)) return;
      this.closeInput();
      this.connection = "lost";
      this.reason = "the controller port disappeared";
      this.remedy = "reconnect the DDJ-FLX4; AutoLight reopens it automatically";
      this.notifyStatus();
      return;
    }
    await this.selectAndOpen();
  }

  status(): Flx4ControllerStatus {
    return {
      mode: this.mode,
      backend: this.driver?.name ?? null,
      connection: this.connection,
      portName: this.input?.port.name ?? null,
      attempts: [...this.attempts],
      lastMessageAtNs: this.lastMessageAtNs,
      lastMessageAgeMs: this.lastMessageAtNs === null ? null : Number(this.nowNs() - this.lastMessageAtNs) / 1e6,
      messagesReceived: this.messagesReceived,
      messagesDropped: this.ring.dropped,
      unknownMessages: this.decoder.unknownCount,
      reason: this.reason,
      remedy: this.remedy,
      portMatch: this.portMatch,
      hotplugPollMs: this.hotplugPollMs,
    };
  }

  recentEvents(limit = 32): Flx4Event[] {
    return this.events.slice(-limit);
  }

  recentMessages(limit = 32): Flx4TimedMessage[] {
    return this.ring.recent(limit);
  }

  onEvent(listener: (event: Flx4Event) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  onStatusChange(listener: (status: Flx4ControllerStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private driverFor(name: Flx4BackendName): Flx4MidiDriver {
    const injected = this.drivers[name];
    if (injected !== undefined) return injected;
    if (name === "native") return createNativeDriver();
    if (name === "webmidi") return createWebMidiDriver();
    return createWindowsMidiServicesDriver();
  }

  private matchPort(ports: Flx4PortInfo[]): Flx4PortInfo | null {
    let pattern: RegExp;
    try {
      pattern = new RegExp(this.portMatch, "i");
    } catch {
      pattern = new RegExp(this.portMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }
    return ports.find((port) => pattern.test(port.name)) ?? null;
  }

  private async selectAndOpen(): Promise<void> {
    if (this.input !== null) return;
    const candidates = this.mode === "auto" ? [...AUTO_BACKEND_ORDER] : [this.mode];
    const attempts: Flx4BackendAttempt[] = [];
    let lastUnavailable: { reason: string; remedy: string } | null = null;
    let sawPort = false;
    for (const name of candidates) {
      const driver = this.driverFor(name);
      const probe = await driver.probe().catch((error: unknown) => ({
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      }));
      if (!probe.ok) {
        attempts.push({ backend: name, ok: false, reason: probe.reason });
        lastUnavailable = { reason: probe.reason, remedy: remedyFor(name) };
        continue;
      }
      const ports = await driver.listPorts().catch(() => [] as Flx4PortInfo[]);
      const port = this.matchPort(ports);
      if (port === null) {
        attempts.push({ backend: name, ok: false, reason: `no input port matches ${this.portMatch}` });
        continue;
      }
      sawPort = true;
      try {
        const input = await driver.open(port, (bytes) => {
          this.acceptBytes(bytes);
        });
        this.driver = driver;
        this.input = input;
        this.attempts = attempts;
        this.connection = "connected";
        this.reason = null;
        this.remedy = null;
        this.notifyStatus();
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push({ backend: name, ok: false, reason: message });
        const heldSingleClient = driver.sharing === "single-client" && this.platform === "win32";
        lastUnavailable = { reason: message, remedy: heldSingleClient ? WINDOWS_HELD_REMEDY : remedyFor(name) };
      }
    }
    this.attempts = attempts;
    if (lastUnavailable !== null) {
      this.connection = "unavailable-on-this-device";
      this.reason = lastUnavailable.reason;
      this.remedy = lastUnavailable.remedy;
    } else if (sawPort) {
      this.connection = "failed";
      this.reason = "the matched port could not be opened by any backend";
      this.remedy = null;
    } else {
      this.connection = "searching";
      this.reason = `no controller matching ${this.portMatch} is connected yet`;
      this.remedy = "connect the DDJ-FLX4 over USB; AutoLight detects it by port name";
    }
    this.notifyStatus();
  }

  private acceptBytes(bytes: readonly number[]): void {
    const receivedAtNs = this.nowNs();
    const status = bytes[0] ?? 0;
    const data1 = bytes[1] ?? 0;
    const data2 = bytes[2] ?? 0;
    this.messagesReceived += 1;
    this.lastMessageAtNs = receivedAtNs;
    this.ring.push({ bytes: [status, data1, data2], receivedAtNs });
    const event = this.decoder.decodeBytes([status, data1, data2], receivedAtNs);
    this.events.push(event);
    if (this.events.length > this.eventCapacity) this.events.shift();
    for (const listener of this.eventListeners) listener(event);
  }

  private closeInput(): void {
    try {
      this.input?.close();
    } catch {
      // Teardown never throws; the port is gone or the backend is already down.
    }
    this.input = null;
    this.driver = null;
  }

  private notifyStatus(): void {
    const status = this.status();
    for (const listener of this.statusListeners) listener(status);
  }
}

function remedyFor(name: Flx4BackendName): string {
  if (name === "native") return "install the @julusian/midi addon for this platform and rebuild it for Electron (T-OPS-05)";
  if (name === "windows-midi-services") return "install Windows MIDI Services and its Node binding on this machine";
  return "start the hidden audio window so Web MIDI is available (T-AUD-01)";
}

// --- native backend (@julusian/midi, RtMidi) --------------------------------

interface RtMidiInput {
  getPortCount(): number;
  getPortName(index: number): string;
  openPort(index: number): void;
  closePort(): void;
  on(event: "message", listener: (deltaTime: number, message: number[]) => void): void;
}

interface RtMidiModule {
  Input: new () => RtMidiInput;
}

export type RtMidiLoader = () => Promise<unknown> | unknown;

// Loaded lazily on purpose: node:module does not exist in the renderer, which
// imports this module for the Web MIDI driver, so a static import cannot work
// here. The addon specifier is a literal at the point of use.
const defaultRtMidiLoader: RtMidiLoader = async () => {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("@julusian/midi");
};

/** Narrows the loaded addon; the Input constructor is only used through RtMidiInput. */
function asRtMidiModule(value: unknown): RtMidiModule {
  if (value === null || typeof value !== "object" || !("Input" in value)) {
    throw new Error("@julusian/midi did not export an Input class");
  }
  const Input: unknown = value.Input;
  if (typeof Input !== "function") throw new Error("@julusian/midi did not export an Input class");
  // Structural constructor: the addon's class satisfies the RtMidiInput surface.
  const constructor = Input as new () => RtMidiInput;
  return { Input: constructor };
}

export function createNativeDriver(load: RtMidiLoader = defaultRtMidiLoader, platform: NodeJS.Platform = process.platform): Flx4MidiDriver {
  return {
    name: "native",
    // CoreMIDI (macOS) and ALSA are multi-client; WinMM input is not.
    sharing: platform === "win32" ? "single-client" : "shared",
    async probe() {
      try {
        asRtMidiModule(await load());
        return { ok: true, reason: "" };
      } catch (error) {
        return { ok: false, reason: `@julusian/midi is not loadable: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
    async listPorts() {
      const input = new (asRtMidiModule(await load()).Input)();
      try {
        const ports: Flx4PortInfo[] = [];
        for (let index = 0; index < input.getPortCount(); index += 1) {
          ports.push({ id: String(index), name: input.getPortName(index) });
        }
        return ports;
      } finally {
        input.closePort();
      }
    },
    async open(port, onMessage) {
      const input = new (asRtMidiModule(await load()).Input)();
      input.openPort(Number(port.id));
      input.on("message", (_deltaTime, message) => {
        onMessage(message);
      });
      return {
        port,
        close() {
          input.closePort();
        },
      };
    },
  };
}

// --- Windows MIDI Services backend ------------------------------------------

interface WindowsMidiServicesBinding {
  listInputPorts(): string[];
  openInput(portName: string, onMessage: (bytes: readonly number[]) => void): { close(): void };
}

export type WindowsMidiServicesLoader = () => Promise<unknown> | unknown;

// Lazily loaded for the same reason as the native loader: this module is also
// imported by the renderer, where node:module does not exist.
const defaultWindowsMidiServicesLoader: WindowsMidiServicesLoader = async () => {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("windows-midi-services");
};

/** Narrows the loaded binding; only listInputPorts/openInput/close are used. */
function asWindowsMidiServicesBinding(value: unknown): WindowsMidiServicesBinding {
  if (value === null || typeof value !== "object") throw new Error("the Windows MIDI Services binding did not load");
  const listInputPorts: unknown = "listInputPorts" in value ? value.listInputPorts : undefined;
  const openInput: unknown = "openInput" in value ? value.openInput : undefined;
  if (typeof listInputPorts !== "function" || typeof openInput !== "function") {
    throw new Error("the Windows MIDI Services binding did not expose listInputPorts/openInput");
  }
  // Structural binding: the loaded addon satisfies the documented surface.
  const list = listInputPorts as () => string[];
  const open = openInput as (name: string, listener: (bytes: readonly number[]) => void) => unknown;
  return {
    listInputPorts: () => list.call(value),
    openInput: (portName, onMessage) => {
      const handle: unknown = open.call(value, portName, onMessage);
      const close: unknown = handle !== null && typeof handle === "object" && "close" in handle ? handle.close : undefined;
      if (typeof close !== "function") throw new Error("the Windows MIDI Services binding returned no closable input");
      const closeFn = close as () => void;
      return {
        close() {
          closeFn.call(handle);
        },
      };
    },
  };
}

export function createWindowsMidiServicesDriver(load: WindowsMidiServicesLoader = defaultWindowsMidiServicesLoader, platform: NodeJS.Platform = process.platform): Flx4MidiDriver {
  return {
    name: "windows-midi-services",
    sharing: "shared",
    async probe() {
      if (platform !== "win32") return { ok: false, reason: "Windows MIDI Services is Windows only" };
      try {
        asWindowsMidiServicesBinding(await load());
        return { ok: true, reason: "" };
      } catch (error) {
        return { ok: false, reason: `the Windows MIDI Services binding is not loadable: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
    async listPorts() {
      return asWindowsMidiServicesBinding(await load()).listInputPorts().map((name) => ({ id: name, name }));
    },
    async open(port, onMessage) {
      const handle = asWindowsMidiServicesBinding(await load()).openInput(port.name, (bytes) => {
        onMessage(bytes);
      });
      return {
        port,
        close() {
          handle.close();
        },
      };
    },
  };
}

// --- Web MIDI backend (renderer) --------------------------------------------

interface WebMidiMessageEvent {
  data: Uint8Array | null;
}

interface WebMidiInputLike {
  id: string;
  name: string | null;
  onmidimessage: ((event: WebMidiMessageEvent) => void) | null;
}

interface WebMidiAccessLike {
  inputs: Map<string, WebMidiInputLike>;
}

export type WebMidiAccessFactory = () => Promise<WebMidiAccessLike>;

/** The Web MIDI API is not in the base DOM typings; the shape is checked with `in` before use. */
function webMidiAccessFromNavigator(): Promise<WebMidiAccessLike> | null {
  const nav: unknown = globalThis.navigator;
  if (nav === null || typeof nav !== "object" || !("requestMIDIAccess" in nav)) return null;
  const request: unknown = nav.requestMIDIAccess;
  if (typeof request !== "function") return null;
  // The access object is a platform boundary; the caller probes it by use.
  const call = request as (this: unknown) => Promise<WebMidiAccessLike>;
  return call.call(nav);
}

const defaultWebMidiAccessFactory: WebMidiAccessFactory = () =>
  webMidiAccessFromNavigator() ??
  Promise.reject(new Error("Web MIDI is not available in this context; it lives in the hidden audio window"));

export function createWebMidiDriver(requestAccess: WebMidiAccessFactory = defaultWebMidiAccessFactory): Flx4MidiDriver {
  return {
    name: "webmidi",
    sharing: "shared",
    async probe() {
      try {
        await requestAccess();
        return { ok: true, reason: "" };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
    async listPorts() {
      const access = await requestAccess();
      return [...access.inputs.values()].map((input) => ({ id: input.id, name: input.name ?? input.id }));
    },
    async open(port, onMessage) {
      const access = await requestAccess();
      const input = [...access.inputs.values()].find((candidate) => candidate.id === port.id);
      if (input === undefined) throw new Error(`Web MIDI input ${port.id} disappeared`);
      input.onmidimessage = (event) => {
        if (event.data !== null) onMessage([...event.data]);
      };
      return {
        port,
        close() {
          input.onmidimessage = null;
        },
      };
    },
  };
}

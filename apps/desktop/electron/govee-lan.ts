// Official Govee LAN transport: the main process owns UDP (spec 149, WP03
// T-GOV-04 through T-GOV-09). Provenance: govee-toolkit MIT (Damien Thery,
// v0.5.0, commit ceef296f6382881c5f07698d78fb5719ebca6686)
// docs/protocol/lan.md sections 1 (consecutive commands), Latency notes,
// 2.1 to 2.3 (arm B1, paint B0, zoned B4) and 2.7 (B2 armed state in the
// status reply); wez/govee2mqtt src/lan_api.rs (discovery ladder, reply
// without ip issue 437, 4002 conflict message, status retry); the official
// Govee WLAN guide (scan to multicast 239.255.255.250:4001, replies on 4002,
// unicast control to device:4003; turn, brightness, devStatus, colorwc).
//
// Sockets (T-GOV-04): one reply socket bound to govee.lan.ports.reply (4002)
// carries discovery plus status replies routed by sender IP (govee2mqtt
// pattern); one send socket per interface is reused for every command and
// frame. No socket is created per send. No child_process anywhere in this
// path. A 4002 conflict throws loudly naming the likely holders.
//
// Discovery (T-GOV-05) climbs one rung per setting (config 3.6, DS-16):
// multicast on every eligible interface, per-interface directed broadcast,
// global broadcast, explicit scan list, cached-IP unicast. Resends double
// from retryInitialMs to retryMaxMs without stopping; a background rescan
// resets the cadence; interface changes and resume rescan immediately.
// Replies without ip are accepted by sender address with a disagree warning;
// devices are keyed by MAC, never by IP.
//
// Registry (T-GOV-06) is MAC-keyed with per-device FPS backoff that touches
// only that device. Tables live in a JSON file under userData until the
// storage service lands them in DB tables (T-DATA-02); the file is the
// honest interim, stated as such.
//
// Read-back (T-GOV-07): devStatus resends every retryMs until deadlineMs,
// routed by sender, skipped while armed. Blackout (T-GOV-09) is an all-zero
// frame on an armed stream, never turn; white hits are RGB scaled in linear
// light; global brightness only travels the slow rate-limited path.
import electron from "electron";
import { createSocket } from "node:dgram";
import type { RemoteInfo, Socket } from "node:dgram";
import { promises as dns } from "node:dns";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import {
  MULTICAST, SCAN_REQUEST, parseDevStatus, envelope,
  devStatusCommand, turnCommand, brightnessCommand, colorCommand,
  arm, paint, blackoutPayload, whiteHitPayload, solidPayload, paintRangePayload, stripeFrame,
  PacingStream, WALL_SCHEDULER,
} from "@autolight/govee";
import type {
  LanDeviceStatus, LanInbound, StreamTransport, StreamOptions,
} from "@autolight/govee";
import { partyFrame } from "./party-effects.js";
import type { PartyEffect, Rgb } from "./party-effects.js";
import { partyBeatEffects } from "@autolight/ipc";

const GLOBAL_BROADCAST = "255.255.255.255";

const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

const RUNG_GAP_MS = 60;

const SAVE_THROTTLE_MS = 5000;

const IP_HISTORY = 8;

// Friendly default labels for known models: a newly discovered device shows a
// product name instead of its MAC until someone renames it. Unknown SKUs keep
// the MAC so nothing is invented.
const DEFAULT_NAMES: Record<string, string> = { H1A45: "Strip lights", H6076: "Lamp" };

export function defaultDeviceName(sku: string, mac: string): string {
  return DEFAULT_NAMES[sku] ?? mac;
}

// Beat effects need a tempo (tap or the operator-started mic estimate); the
// other party effects ignore bpm entirely.
function isBeatEffect(effect: PartyEffect): boolean {
  return (partyBeatEffects as readonly string[]).includes(effect);
}

const RUNG_MARKS = 32;

export type DiscoveryRung =
  | "multicast" | "broadcast" | "global" | "scan-list" | "cached-unicast" | "background";

export interface GoveeManagerOptions {
  scanPort?: number;
  replyPort?: number;
  controlPort?: number;
  interfaces?: string[];
  loopbackScan?: boolean;
  multicast?: boolean;
  perInterfaceBroadcast?: boolean;
  globalBroadcast?: boolean;
  scanList?: string[];
  retryInitialMs?: number;
  retryMaxMs?: number;
  backgroundRescanMs?: number;
  offlineAfterMs?: number;
  statusRetryMs?: number;
  statusDeadlineMs?: number;
  armSettleMsDefault?: number;
  fallbackHz?: number;
  targetHz?: number;
  gradient?: number;
  keepaliveMs?: number;
  maxRearmAttempts?: number;
  rearmWindowMs?: number;
  minSpacingMs?: number;
  reconnectMaxMs?: number;
  backoffMinFps?: number;
  brightnessMaxPerMinute?: number;
  identifyFlashMs?: number;
  testChaseStepMs?: number;
  registryPath?: string;
  clock?: () => number;
  wait?: (ms: number) => Promise<void>;
}

// Govee LAN defaults: the fallback every config key starts from (govee.lan.*).
const GOVEE_DEFAULTS = {
  scanPort: 4001,
  replyPort: 4002,
  controlPort: 4003,
  interfaces: [] as string[],
  loopbackScan: false,
  multicast: true,
  perInterfaceBroadcast: true,
  globalBroadcast: true,
  scanList: [] as string[],
  retryInitialMs: 2000,
  retryMaxMs: 60000,
  backgroundRescanMs: 30000,
  // Must exceed backgroundRescanMs (30s): rounds are the only guaranteed
  // liveness refresh, so a shorter window marks healthy streaming devices
  // offline at the top of every round and re-arms them on the reply — a
  // visible flash every round (reconnects climbing one per 30s).
  offlineAfterMs: 75000,
  statusRetryMs: 350,
  statusDeadlineMs: 10000,
  armSettleMsDefault: 50,
  fallbackHz: 10,
  targetHz: 60,
  gradient: 0,
  keepaliveMs: 0,
  maxRearmAttempts: 3,
  rearmWindowMs: 60000,
  minSpacingMs: 40,
  reconnectMaxMs: 5000,
  backoffMinFps: 5,
  brightnessMaxPerMinute: 6,
  identifyFlashMs: 1000,
  testChaseStepMs: 150,
} as const;

// Every discovery and stream default mirrors 03-config-and-decisions.md
// section 3.6 so the manager runs standalone and the app injects config.
export function optionsFromConfig(get: (key: string) => unknown): GoveeManagerOptions {
  const num = (key: string, fallback: number): number => {
    const v = get(key);

    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };

  const bool = (key: string, fallback: boolean): boolean => {
    const v = get(key);

    return typeof v === "boolean" ? v : fallback;
  };

  const strings = (key: string): string[] => {
    const v = get(key);

    return Array.isArray(v) ? v.filter((e): e is string => typeof e === "string") : [];
  };

  return {
    scanPort: num("govee.lan.ports.scan", GOVEE_DEFAULTS.scanPort),
    replyPort: num("govee.lan.ports.reply", GOVEE_DEFAULTS.replyPort),
    controlPort: num("govee.lan.ports.control", GOVEE_DEFAULTS.controlPort),
    interfaces: strings("govee.lan.interfaces"),
    multicast: bool("govee.lan.discovery.multicast", true),
    perInterfaceBroadcast: bool("govee.lan.discovery.perInterfaceBroadcast", true),
    globalBroadcast: bool("govee.lan.discovery.globalBroadcast", true),
    scanList: strings("govee.lan.discovery.scanList"),
    retryInitialMs: num("govee.lan.discovery.retryInitialMs", GOVEE_DEFAULTS.retryInitialMs),
    retryMaxMs: num("govee.lan.discovery.retryMaxMs", GOVEE_DEFAULTS.retryMaxMs),
    backgroundRescanMs: num("govee.lan.discovery.backgroundRescanMs", GOVEE_DEFAULTS.backgroundRescanMs),
    statusRetryMs: num("govee.lan.status.retryMs", GOVEE_DEFAULTS.statusRetryMs),
    statusDeadlineMs: num("govee.lan.status.deadlineMs", GOVEE_DEFAULTS.statusDeadlineMs),
    armSettleMsDefault: num("govee.lan.arm.settleMsDefault", GOVEE_DEFAULTS.armSettleMsDefault),
    fallbackHz: num("govee.lan.stream.fallbackHz", GOVEE_DEFAULTS.fallbackHz),
    targetHz: num("govee.lan.stream.targetHz", GOVEE_DEFAULTS.targetHz),
    maxRearmAttempts: num("govee.lan.stream.maxRearmAttempts", GOVEE_DEFAULTS.maxRearmAttempts),
    rearmWindowMs: num("govee.lan.stream.rearmWindowMs", GOVEE_DEFAULTS.rearmWindowMs),
    minSpacingMs: num("govee.lan.command.minSpacingMs", GOVEE_DEFAULTS.minSpacingMs),
    reconnectMaxMs: num("govee.lan.reconnect.maxMs", GOVEE_DEFAULTS.reconnectMaxMs),
    backoffMinFps: num("govee.lan.backoff.minFps", GOVEE_DEFAULTS.backoffMinFps),
    brightnessMaxPerMinute: num("govee.brightness.maxPerMinute", GOVEE_DEFAULTS.brightnessMaxPerMinute),
    identifyFlashMs: num("govee.identify.flashMs", GOVEE_DEFAULTS.identifyFlashMs),
    testChaseStepMs: num("govee.testChase.stepMs", GOVEE_DEFAULTS.testChaseStepMs),
  };
}

export interface DeviceEntrySnapshot {
  mac: string;
  sku: string;
  name: string;
  enabled: boolean;
  ip: string;
  ipInferred: boolean;
  lastSeenMs: number;
  rung: DiscoveryRung;
  firmware: string;
  health: "online" | "degraded" | "offline";
  fps: number;
  armed: boolean;
  zones: number | null;
  sentFrames: number;
  supersededFrames: number;
  rttMs: number | null;
  consecutiveFailures: number;
  reconnects: number;
  disagreeCount: number;
  observed: LanDeviceStatus | null;
  requested: { on: boolean; brightness: number; generation: number };
}

export interface DevStatusResult {
  mac: string;
  answered: boolean;
  attempts: number;
  rttMs: number | null;
  status: LanDeviceStatus | null;
  skippedWhileArmed: boolean;
}

export interface IdentifyReceipt {
  mac: string;
  address: string;
  path: "stream" | "colorwc";
  restored: "current-frame" | "blackout-frame" | "observed-state" | "no-read-back";
  observedAnswered: boolean;
}

export interface ChaseReceipt {
  mac: string;
  address: string;
  path: "stream" | "brightness-ramp";
  steps: number;
}

/** Manual-lane batch outcome: fixtures commanded and per-fixture failures. */
export interface ManualReceipt {
  ok: string[];
  failed: { mac: string; message: string }[];
}

type AlternateMode = "lamps" | "halves";

interface AlternateColours {
  a: [number, number, number];
  b: [number, number, number];
}

/** Alternate-runner request: the rig's fixtures swap, or each strip splits
 *  in half and the halves swap. Colours are explicit — the caller decides
 *  what the off phase shows (black, the inverse, or a second pick). */
export interface AlternateOptions {
  mode: AlternateMode;
  speedMs: number;
  colours: AlternateColours;
  /** Party effect to run instead of the plain A/B swap (LED_PARTY port). */
  effect?: PartyEffect;
  /** Palette driving pulse/jump/strobe, e.g. PARTY_PALETTES.Neon. */
  palette?: Rgb[];
  /** Tempo for the beat effects; tap tempo or the operator-started mic
   *  estimate. Live-updatable through setAlternateBpm. */
  bpm?: number;
}

export interface AlternateReceipt {
  mode: AlternateMode;
  speedMs: number;
  fixtures: number;
  colours: AlternateColours;
  effect?: PartyEffect;
  bpm?: number;
}

interface AlternateStateInternal extends AlternateOptions {
  timer: NodeJS.Timeout;
  phase: boolean;
  tick: number;
}

export interface DeviceStream {
  readonly mac: string;
  readonly zones: number;
  readonly closed: boolean;
  setAll(frame: Uint8Array): void;
  close(): void;
  metrics(): { requested: number; sent: number; superseded: number; missedTicks: number; effectiveHz: number };
}

interface DeviceEntry extends Omit<DeviceEntrySnapshot, "requested"> {
  name: string;
  enabled: boolean;
  /** Operator-confirmed segment count (wizard step 9); null until saved.
   *  `zones` stays the live stream count, which a probe may temporarily
   *  set without the operator having confirmed it. */
  zonesSaved: number | null;
  /** Last solid colour commanded, so a confirmed count can repaint the
   *  standing look across the strip without asking again. */
  lastColor: [number, number, number] | null;
  ipHistory: string[];
  bleHard: string;
  bleSoft: string;
  wifiHard: string;
  wifiSoft: string;
  lastSuccessMs: number;
  lastFailureMs: number;
  requestedOn: boolean;
  requestedBrightness: number;
  generation: number;
  stream: PacingStream | null;
  streamClosed: boolean;
  streamDesired: boolean;
  lastFrame: Uint8Array | null;
  pendingBlackout: boolean;
  lastCommandAt: number;
  lastBrightnessSentMs: number;
  pendingBrightness: number | null;
  brightnessTimer: NodeJS.Timeout | null;
  keepaliveTimer: NodeJS.Timeout | null;
  rearmAt: number[];
  lastSendError: string | null;
}

interface ReplyWaiter {
  ips: Set<string>;
  want: "devStatus" | "any";
  resolve: (text: string | null) => void;
  timer: NodeJS.Timeout;
}

interface RungMark {
  rung: DiscoveryRung;
  at: number;
}

// Broadcast address for one interface: host bits set (govee2mqtt order needs
// the per-interface directed broadcast before the global one).
function directedBroadcast(ip: string, netmask: string): string | null {
  const a = ip.split(".").map(Number);
  const m = netmask.split(".").map(Number);

  if (a.length !== 4 || m.length !== 4) return null;
  const out: number[] = [];

  for (let i = 0; i < 4; i++) {
    const o = a[i] ?? -1;
    const k = m[i] ?? -1;

    if (!Number.isInteger(o) || o < 0 || o > 255 || !Number.isInteger(k) || k < 0 || k > 255) return null;
    out.push(o | (~k & 255));
  }

  return out.join(".");
}

function sameSubnet(ip: string, ifaceIp: string, netmask: string): boolean {
  const a = ip.split(".").map(Number);
  const b = ifaceIp.split(".").map(Number);
  const m = netmask.split(".").map(Number);

  if (a.length !== 4 || b.length !== 4 || m.length !== 4) return false;

  for (let i = 0; i < 4; i++) {
    if (((a[i] ?? -1) & (m[i] ?? 0)) !== ((b[i] ?? -2) & (m[i] ?? 0))) return false;
  }

  return true;
}

// T-GOV-16 network hygiene (spec 111): default bind set is private LAN
// addresses only (RFC 1918). Anything else (public, CGNAT, unclassified) is
// never bound: the manager refuses WAN interfaces even if selected.
function isPrivateIpv4(ip: string): boolean {
  const a = ip.split(".").map(Number);

  if (a.length !== 4) return false;

  for (const o of a) if (!Number.isInteger(o) || o < 0 || o > 255) return false;
  const b0 = a[0] ?? -1;
  const b1 = a[1] ?? -1;

  if (b0 === 10) return true;

  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

  if (b0 === 192 && b1 === 168) return true;

  return false;
}

function subnetAddress(ip: string, netmask: string): string | null {
  const a = ip.split(".").map(Number);
  const m = netmask.split(".").map(Number);

  if (a.length !== 4 || m.length !== 4) return null;
  const out: number[] = [];

  for (let i = 0; i < 4; i++) {
    const o = a[i] ?? -1;
    const k = m[i] ?? -1;

    if (!Number.isInteger(o) || o < 0 || o > 255 || !Number.isInteger(k) || k < 0 || k > 255) return null;
    out.push(o & k);
  }

  return out.join(".");
}

function firewallHints(platform: string = process.platform): string[] {
  if (platform === "darwin") {
    return [
      "Allow AutoLight incoming connections: Settings > Network > Firewall.",
      "Accept the Local Network privacy prompt on first scan; without it discovery replies never arrive.",
    ];
  }

  if (platform === "win32") {
    return [
      "Allow UDP ports 4001-4003 inbound and outbound in Windows Defender Firewall.",
      "The network profile must be Private, not Public; check Settings > Network.",
    ];
  }

  return [
    "Allow UDP ports 4001-4003 both ways (for example: ufw allow 4001:4003/udp).",
  ];
}

const defaultWait = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, Math.max(0, ms));

  return promise;
};

let shared: GoveeLanManager | null = null;

export function getGoveeManager(init?: GoveeManagerOptions): GoveeLanManager {
  if (!shared) shared = new GoveeLanManager(init);
  else if (init) shared.applyLiveTunables(init);

  return shared;
}

export function resetGoveeManager(): void {
  shared?.stop();
  shared = null;
}

export class GoveeLanManager implements StreamTransport {
  private readonly o: Omit<Required<GoveeManagerOptions>, "registryPath" | "clock" | "wait"> & {
    registryPath: string | undefined;
  };
  private readonly clock: () => number;
  private readonly wait: (ms: number) => Promise<void>;
  private replySock: Socket | null = null;
  private readonly senders = new Map<string, { socket: Socket; address: string | null; netmask: string | null }>();
  private readonly devices = new Map<string, DeviceEntry>();
  private readonly waiters: ReplyWaiter[] = [];
  // Send times of per-device unicast scans, keyed by destination ip: a scan
  // reply measures round-trip latency for devices that never answer devStatus
  // (the H6076 ignores it), so their rtt still resolves every round.
  private readonly scanSentAt = new Map<string, number>();
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly marks: RungMark[] = [];
  private readonly warnings: { at: number; message: string }[] = [];
  private started = false;
  private starting: Promise<void> | null = null;
  private loopLive = false;
  private retryDelayMs: number;
  private roundInFlight = false;
  private backgroundTimer: NodeJS.Timeout | null = null;
  private lastError: string | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private lastIfaceSig = "";
  private scanRounds = 0;
  private refusedWan: { name: string; address: string }[] = [];
  private multicastOk = new Map<string, boolean>();
  private alternate: AlternateStateInternal | null = null;
  private alternateBusy = false;

  constructor(opts: GoveeManagerOptions = {}) {
    const d = GOVEE_DEFAULTS;
    this.o = {
      scanPort: opts.scanPort ?? d.scanPort,
      replyPort: opts.replyPort ?? d.replyPort,
      controlPort: opts.controlPort ?? d.controlPort,
      interfaces: opts.interfaces ?? [...d.interfaces],
      loopbackScan: opts.loopbackScan ?? d.loopbackScan,
      multicast: opts.multicast ?? d.multicast,
      perInterfaceBroadcast: opts.perInterfaceBroadcast ?? d.perInterfaceBroadcast,
      globalBroadcast: opts.globalBroadcast ?? d.globalBroadcast,
      scanList: opts.scanList ?? [...d.scanList],
      retryInitialMs: Math.max(100, opts.retryInitialMs ?? d.retryInitialMs),
      retryMaxMs: Math.max(1000, opts.retryMaxMs ?? d.retryMaxMs),
      backgroundRescanMs: Math.max(1000, opts.backgroundRescanMs ?? d.backgroundRescanMs),
      offlineAfterMs: Math.max(1000, opts.offlineAfterMs ?? d.offlineAfterMs),
      statusRetryMs: Math.max(1, opts.statusRetryMs ?? d.statusRetryMs),
      statusDeadlineMs: Math.max(1, opts.statusDeadlineMs ?? d.statusDeadlineMs),
      armSettleMsDefault: Math.max(0, opts.armSettleMsDefault ?? d.armSettleMsDefault),
      fallbackHz: Math.max(1, opts.fallbackHz ?? d.fallbackHz),
      targetHz: Math.max(1, opts.targetHz ?? d.targetHz),
      gradient: opts.gradient ?? d.gradient,
      keepaliveMs: Math.max(0, opts.keepaliveMs ?? d.keepaliveMs),
      maxRearmAttempts: Math.max(0, opts.maxRearmAttempts ?? d.maxRearmAttempts),
      rearmWindowMs: Math.max(1000, opts.rearmWindowMs ?? d.rearmWindowMs),
      minSpacingMs: Math.max(0, opts.minSpacingMs ?? d.minSpacingMs),
      reconnectMaxMs: Math.max(100, opts.reconnectMaxMs ?? d.reconnectMaxMs),
      backoffMinFps: Math.max(1, opts.backoffMinFps ?? d.backoffMinFps),
      brightnessMaxPerMinute: Math.max(1, opts.brightnessMaxPerMinute ?? d.brightnessMaxPerMinute),
      identifyFlashMs: Math.max(0, opts.identifyFlashMs ?? d.identifyFlashMs),
      testChaseStepMs: Math.max(0, opts.testChaseStepMs ?? d.testChaseStepMs),
      registryPath: opts.registryPath,
    };
    this.clock = opts.clock ?? Date.now;
    this.wait = opts.wait ?? defaultWait;
    this.retryDelayMs = this.o.retryInitialMs;
  }

  // -- lifetime ------------------------------------------------------------

  async start(): Promise<void> {
    if (this.started) return;

    if (this.starting) {
      await this.starting;

      return;
    }

    const gate = Promise.withResolvers<void>();
    this.starting = gate.promise;

    try {
      this.loadRegistry();
      const sock = createSocket("udp4");
      sock.on("message", (msg: Buffer, rinfo: RemoteInfo) => {
        this.handleMessage(msg, rinfo);
      });
      await new Promise<void>((bound, failed) => {
        // The executor form is required here: bind takes a callback, and the
        // once-error must be withdrawn on success so it never fires later.
        const onError = (err: Error): void => failed(err);
        sock.once("error", onError);
        sock.bind(this.o.replyPort, () => {
          sock.removeListener("error", onError);
          bound();
        });
      });
      sock.on("error", (err: Error) => {
        this.lastError = err.message;
      });
      this.replySock = sock;

      try {
        sock.unref?.();
      } catch { /* loop already draining; socket still works */ }

      const ifaces = this.eligibleInterfaces();

      for (const iface of ifaces) {
        try {
          sock.addMembership(MULTICAST, iface.address);
          this.multicastOk.set(iface.address, true);
        } catch {
          this.multicastOk.set(iface.address, false);
        }
      }

      try {
        (electron as { powerMonitor?: { on: (event: string, fn: () => void) => void } }).powerMonitor?.on("resume", () => {
          this.notifyResume();
        });
      } catch { /* not under Electron (tests); resume is notified explicitly */ }

      this.started = true;
      this.lastError = null;
      this.openSenders(ifaces);
      this.startDiscovery();
      gate.resolve();
    } catch (err) {
      const code = typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: unknown }).code
        : null;

      if (code === "EADDRINUSE") {
        this.lastError =
          `govee reply port ${this.o.replyPort} is already bound: likely holders are ` +
          `Govee Desktop, homebridge-govee, SignalRGB, Govee LAN Control, or another ` +
          `AutoLight instance. Fix: quit the holder, or move govee.lan.ports.reply.`;
      } else {
        this.lastError = err instanceof Error ? err.message : String(err);
      }

      this.replySock = null;
      gate.reject(new Error(this.lastError));
    } finally {
      this.starting = null;
    }

    await gate.promise;
  }

  stop(): void {
    this.stopDiscovery();

    for (const w of this.waiters.splice(0)) {
      clearTimeout(w.timer);
      w.resolve(null);
    }

    for (const entry of this.devices.values()) {
      this.clearStreamTimers(entry);
    }

    for (const s of this.senders.values()) {
      try {
        s.socket.close();
      } catch { /* already closed */ }
    }

    this.senders.clear();

    if (this.replySock) {
      try {
        this.replySock.close();
      } catch { /* already closed */ }

      this.replySock = null;
    }

    this.multicastOk.clear();
    this.started = false;
  }

  socketCount(): number {
    return (this.replySock === null ? 0 : 1) + this.senders.size;
  }

  portStatus(): { replyPort: number; bound: boolean; sendSockets: number; lastError: string | null } {
    return {
      replyPort: this.o.replyPort,
      bound: this.replySock !== null,
      sendSockets: this.senders.size,
      lastError: this.lastError,
    };
  }

  discoveryStats(): {
    rounds: number;
    devices: number;
    retryDelayMs: number;
    warnings: { at: number; message: string }[];
  } {
    return {
      rounds: this.scanRounds,
      devices: this.devices.size,
      retryDelayMs: this.retryDelayMs,
      warnings: [...this.warnings].slice(-20),
    };
  }

  // -- network hygiene and trust status (T-GOV-16, spec 111) --------------------
  //
  // The single source the Diagnostics network tab renders: bound interfaces,
  // subnets, multicast health per interface, refused WAN interfaces, the
  // client-isolation signal, the SignalRGB checklist, and firewall hints.
  networkTrust(): {
    interfaces: { name: string; address: string; netmask: string; subnet: string | null; broadcast: string | null }[];
    refusedWan: { name: string; address: string }[];
    multicastOk: { address: string; ok: boolean }[];
    isolationSuspects: { mac: string; ip: string; subnet: string | null }[];
    checklist: { id: string; label: string; state: "ok" | "suspect" | "manual"; detail: string }[];
    firewallHints: string[];
  } {
    const ifaces = this.eligibleInterfaces();

    const bound = ifaces.map((i) => ({
      name: i.name,
      address: i.address,
      netmask: i.netmask,
      subnet: subnetAddress(i.address, i.netmask),
      broadcast: i.broadcast,
    }));

    const onBoundSubnet = (ip: string): string | null => {
      for (const i of ifaces) {
        if (sameSubnet(ip, i.address, i.netmask)) {
          return subnetAddress(i.address, i.netmask);
        }
      }

      return null;
    };

    const isolationSuspects: { mac: string; ip: string; subnet: string | null }[] = [];

    for (const entry of this.devices.values()) {
      if (!entry.ip) continue;
      const subnet = onBoundSubnet(entry.ip);

      if (subnet === null) continue;

      if (entry.health === "offline" && this.scanRounds > 0) {
        isolationSuspects.push({ mac: entry.mac, ip: entry.ip, subnet });
      }
    }

    const multicastOk = bound.map((b) => ({
      address: b.address,
      ok: this.multicastOk.get(b.address) ?? false,
    }));

    const multicastFailed = multicastOk.some((m) => !m.ok);
    const sameSubnetOk = bound.length > 0;
    const firstHint = firewallHints()[0] ?? "Allow UDP ports 4001-4003 inbound and outbound.";

    return {
      interfaces: bound,
      refusedWan: [...this.refusedWan],
      multicastOk,
      isolationSuspects,
      checklist: [
        {
          id: "lan-toggle",
          label: "LAN control enabled in Govee Home for each device",
          state: "manual",
          detail: "Govee Home > device > settings > LAN control must be on; discovery never sees a device with it off.",
        },
        {
          id: "same-subnet",
          label: "Host and lights on the same subnet",
          state: sameSubnetOk ? "ok" : "suspect",
          detail: sameSubnetOk
            ? `Bound to ${bound.map((b) => `${b.address}/${b.subnet ?? "?"}`).join(", ")}.`
            : "No private LAN interface bound; check the cable or Wi-Fi and govee.lan.interfaces.",
        },
        {
          id: "multicast",
          label: "Multicast discovery works",
          state: multicastFailed ? "suspect" : "ok",
          detail: multicastFailed
            ? "A multicast join failed on at least one interface; directed broadcast and scan list still cover discovery."
            : "Joined 239.255.255.250 on every bound interface.",
        },
        {
          id: "guest-network",
          label: "Not a guest network",
          state: "manual",
          detail: "Guest networks usually block LAN device traffic even on the same SSID name; use the main network.",
        },
        {
          id: "client-isolation",
          label: "AP and client isolation off",
          state: isolationSuspects.length > 0 ? "suspect" : "ok",
          detail: isolationSuspects.length > 0
            ? `${isolationSuspects.length} known device(s) on a bound subnet stop answering unicast: check AP/client isolation on the router or move to a travel router.`
            : "Every known device on a bound subnet answers unicast.",
        },
        {
          id: "firewall",
          label: "Firewall allows UDP 4001-4003 both ways",
          state: "manual",
          detail: firstHint,
        },
      ],
      firewallHints: firewallHints(),
    };
  }

  // -- discovery ladder (T-GOV-05) ------------------------------------------

  startDiscovery(): void {
    if (this.loopLive) return;
    this.loopLive = true;
    this.retryDelayMs = this.o.retryInitialMs;
    void this.loop();
    this.backgroundTimer = setInterval(() => {
      this.retryDelayMs = this.o.retryInitialMs;
      void this.round();
    }, this.o.backgroundRescanMs);

    try {
      this.backgroundTimer.unref?.();
    } catch { /* process must stay alive for the show anyway */ }
  }

  stopDiscovery(): void {
    this.loopLive = false;

    if (this.backgroundTimer !== null) {
      clearInterval(this.backgroundTimer);
      this.backgroundTimer = null;
    }
  }

  notifyResume(): void {
    this.retryDelayMs = this.o.retryInitialMs;
    void this.round();
  }

  notifyNetworkChange(): void {
    this.retryDelayMs = this.o.retryInitialMs;
    void this.round();
  }

  async scanOnce(collectMs = 1500): Promise<DeviceEntrySnapshot[]> {
    await this.start();
    this.retryDelayMs = this.o.retryInitialMs;
    await this.round();
    await this.wait(Math.max(0, collectMs));

    return this.registrySnapshot();
  }

  // -- StreamTransport: engines and the probe write through this --------------

  sendRaw(deviceId: string, raw: Uint8Array): void {
    this.sendJson(deviceId, envelope(raw));
  }

  sendJson(deviceId: string, text: string): void {
    const entry = this.devices.get(deviceId);

    if (!entry) {
      this.warn(`send to unknown device ${deviceId}: dropped (scan first)`);

      return;
    }

    const sender = this.senderFor(entry.ip);

    if (!sender) return;

    try {
      sender.socket.send(text, this.o.controlPort, entry.ip, (err: Error | null) => {
        if (err) this.noteFailure(entry, err.message);
      });
    } catch (err) {
      this.noteFailure(entry, err instanceof Error ? err.message : String(err));
    }
  }
  reply(deviceId: string, timeoutMs: number, want: "devStatus" | "any" = "any"): Promise<string | null> {
    const entry = this.devices.get(deviceId);
    const gate = Promise.withResolvers<string | null>();

    if (!entry) {
      gate.resolve(null);

      return gate.promise;
    }

    const resolve = gate.resolve;

    const timer = setTimeout(() => {
      const at = this.waiters.findIndex((w) => w.resolve === resolve);

      if (at >= 0) this.waiters.splice(at, 1);
      resolve(null);
    }, Math.max(1, timeoutMs));

    try {
      timer.unref?.();
    } catch { /* waiter still resolves on reply or stop */ }

    this.waiters.push({ ips: new Set([entry.ip, ...entry.ipHistory]), want, resolve, timer });

    return gate.promise;
  }

  // -- read-back (T-GOV-07) ----------------------------------------------------

  async requestDevStatus(mac: string, opts?: { retryMs?: number; deadlineMs?: number; quiet?: boolean }): Promise<DevStatusResult> {
    await this.start();
    const entry = this.require(mac);

    // Read-only, so it also runs while armed: skipping armed devices made rtt
    // unmeasurable exactly when the rig is live. Quiet probes do not count a
    // sleeping device as a failure.
    const retryMs = Math.max(1, opts?.retryMs ?? this.o.statusRetryMs);
    const deadlineMs = Math.max(1, opts?.deadlineMs ?? this.o.statusDeadlineMs);
    const started = this.clock();
    let attempts = 0;

    for (;;) {
      const sentAt = this.clock();
      attempts += 1;
      await this.enqueue(entry.mac, async () => {
        // Replies return to the sender's port, so the status request goes
        // out on the reply socket; one-way commands use the send socket.
        const sock = this.replySock;

        if (sock) {
          try {
            sock.send(devStatusCommand(), this.o.controlPort, entry.ip, () => undefined);
          } catch { /* next retry covers it */ }
        }
      });
      const text = await this.reply(entry.mac, retryMs, "devStatus");

      if (text !== null) {
        let parsed: LanDeviceStatus | null = null;

        try {
          parsed = parseDevStatus(JSON.parse(text));
        } catch {
          parsed = null;
        }

        if (parsed !== null) {
          entry.observed = parsed;
          entry.rttMs = this.clock() - sentAt;
          entry.lastSeenMs = this.clock();
          entry.consecutiveFailures = 0;
          entry.lastSuccessMs = this.clock();

          if (entry.health !== "online") entry.health = "online";
          this.saveRegistrySoon();

          return { mac, answered: true, attempts, rttMs: entry.rttMs, status: parsed, skippedWhileArmed: false };
        }
      }

      if (this.clock() - started + retryMs > deadlineMs) {
        if (opts?.quiet !== true) this.noteFailure(entry, `devStatus unanswered after ${attempts} attempts`);

        return { mac, answered: false, attempts, rttMs: null, status: null, skippedWhileArmed: false };
      }

      await this.wait(retryMs);
    }
  }

  // -- stream lifecycle (T-GOV-08) ----------------------------------------------

  async ensureArmed(mac: string): Promise<void> {
    await this.start();
    const entry = this.require(mac);
    await this.enqueue(entry.mac, async () => {
      if (entry.armed) return;
      await this.spaced(entry);

      if (entry.observed?.onOff !== true) this.sendJson(entry.mac, turnCommand(true));
      await this.spaced(entry);
      this.sendJson(entry.mac, envelope(arm(true)));
      await this.wait(this.o.armSettleMsDefault);
      entry.armed = true;
    });
  }

  async openStream(mac: string, opts: { zones: number; fps?: number; gradient?: number }): Promise<DeviceStream> {
    await this.ensureArmed(mac);
    const entry = this.require(mac);
    const fps = Math.min(this.o.targetHz, Math.max(this.o.backoffMinFps, Math.round(opts.fps ?? this.o.fallbackHz)));
    const existing = entry.stream;

    if (existing && !entry.streamClosed && existing.rateHz === fps && existing.zones === opts.zones) {
      return this.wrapStream(entry, existing);
    }

    if (existing && !entry.streamClosed) {
      entry.streamClosed = true;

      try {
        existing.close();
      } catch { /* pacing loop already torn down */ }
    }

    entry.zones = opts.zones;
    entry.fps = fps;
    entry.streamDesired = true;

    const streamOpts: StreamOptions = {
      resolution: opts.zones,
      rateHz: fps,
      gradient: opts.gradient ?? this.o.gradient,
      armSettleMs: 0,
      arm: false,
    };

    const stream = new PacingStream(entry.mac, streamOpts, this, WALL_SCHEDULER);
    entry.stream = stream;
    entry.streamClosed = false;

    if (entry.pendingBlackout) {
      entry.pendingBlackout = false;
      const zeros = blackoutPayload(opts.zones);
      entry.lastFrame = zeros.slice();
      stream.setAll(zeros);
    } else if (entry.lastFrame && entry.lastFrame.length === opts.zones * 3) {
      stream.setAll(entry.lastFrame);
    }

    this.armKeepalive(entry);

    return this.wrapStream(entry, stream);
  }

  async pushFrame(mac: string, frame: Uint8Array): Promise<void> {
    const entry = this.require(mac);
    const zones = Math.floor(frame.length / 3);

    if (zones <= 0) throw new RangeError(`pushFrame needs 3 bytes per zone, got ${frame.length}`);

    if (entry.zones !== null && entry.zones !== zones) {
      await this.openStream(mac, { zones });

      return;
    }

    const stream = entry.stream;

    if (!stream || entry.streamClosed) {
      await this.openStream(mac, { zones, fps: entry.fps });

      return;
    }

    entry.lastFrame = frame.slice();
    stream.setAll(frame);
  }

  setZones(mac: string, zones: number): void {
    const entry = this.require(mac);

    if (!Number.isInteger(zones) || zones <= 0 || zones > 255) {
      throw new RangeError(`setZones needs 1..255, got ${zones} (fix: qualify the unit first)`);
    }

    entry.zonesSaved = zones;
    entry.zones = zones;
    // Operator-confirmed counts are durable knowledge: keep them across
    // restarts so the console and the segmented chase come back armed.
    this.saveRegistrySoon();
    // Saving the count ends the stripes probe: reopen the stream at the
    // confirmed size and repaint the standing colour across the whole
    // strip, so the far zones are never left showing probe stripes.
    const colour = entry.lastColor;

    if (colour !== null) {
      void (async () => {
        try {
          await this.ensureStreamAt(entry.mac, zones);
          const live = this.require(entry.mac);
          const frame = solidPayload(zones, colour[0], colour[1], colour[2]);

          live.lastFrame = frame.slice();
          live.stream?.setAll(frame);
        } catch (err) {
          this.warn(`segment repaint failed for ${entry.mac}: ${err instanceof Error ? err.message : String(err)}`);
        }
      })();
    }
  }

  /** Address an explicit fixture set (the console's per-light picker).
   *  Targets are deliberate user picks, so the enabled filter does not
   *  apply; unknown ids fail per-fixture instead of throwing as a batch. */
  async setColorFor(macs: readonly string[], r: number, g: number, b: number): Promise<ManualReceipt> {
    // Same restart path as commandEnabled: an explicit target can arrive
    // before any scan in this process, so seed from the registry first.
    if (this.devices.size === 0) this.loadRegistry();
    const ok: string[] = [];
    const failed: { mac: string; message: string }[] = [];

    for (const id of macs) {
      try {
        const entry = this.require(id);

        await this.setColor(entry.mac, r, g, b);
        ok.push(entry.mac);
      } catch (err) {
        failed.push({ mac: id, message: err instanceof Error ? err.message : String(err) });
      }
    }

    return { ok, failed };
  }

  /** Segment probe (wizard step 9): arm at the candidate count and paint
   *  alternating stripes, so the operator can count the bands on the unit.
   *  The count is only durable once the operator confirms it via setZones. */
  async paintStripes(mac: string, zones: number): Promise<{ mac: string; zones: number }> {
    await this.start();
    const entry = this.require(mac);

    if (!Number.isInteger(zones) || zones <= 0 || zones > 255) {
      throw new RangeError(`paintStripes needs 1..255 zones, got ${zones}`);
    }

    await this.ensureStreamAt(entry.mac, zones);
    const live = this.require(entry.mac);
    const frame = stripeFrame(zones);

    live.lastFrame = frame.slice();
    live.stream?.setAll(frame);

    return { mac: live.mac, zones };
  }

  /** One contiguous zone range in one colour (console segment paint).
   *  Needs the operator-confirmed count: counting segments is their step. */
  async paintRange(mac: string, from: number, to: number, r: number, g: number, b: number): Promise<{ mac: string; zones: number; from: number; to: number }> {
    await this.start();
    const entry = this.require(mac);
    const zones = entry.zonesSaved ?? 0;

    if (zones <= 0) {
      throw new Error(`paintRange needs a saved segment count for ${mac} (fix: paint stripes, count the bands, save the count)`);
    }

    await this.ensureStreamAt(entry.mac, zones);
    const live = this.require(entry.mac);
    const frame = paintRangePayload(zones, from, to, r, g, b);

    live.lastFrame = frame.slice();
    live.stream?.setAll(frame);

    return { mac: live.mac, zones, from, to };
  }

  private async ensureStreamAt(mac: string, zones: number): Promise<void> {
    const entry = this.require(mac);
    const stream = entry.stream;

    // Compare the live stream's own size (entry.zones may already have been
    // updated by setZones before the stream caught up).
    if (stream && !entry.streamClosed && stream.zones === zones) return;
    await this.openStream(mac, { zones });
  }

  // -- alternate runner (manual lane; LED_PARTY AB swap / single spot) -------

  /** Alternate between the rig's fixtures (lamps) or between the two halves
   *  of each strip (halves; needs operator-confirmed counts). Pattern swap
   *  puts group B off while group A burns; complement gives B the inverse
   *  colour. Base is the standing colour the picker set. */
  startAlternate(opts: AlternateOptions): AlternateReceipt {
    const enabled = [...this.devices.values()].filter((e) => e.enabled);

    if (enabled.length === 0) {
      throw new Error("alternate needs a fixture on the rig (fix: scan the LAN in Venue)");
    }

    if (opts.mode === "lamps" && enabled.length < 2) {
      throw new Error(`alternate over lamps needs two fixtures on the rig, found ${enabled.length} (fix: enable both lights)`);
    }

    if (opts.mode === "halves") {
      const missing = enabled.filter((e) => (e.zonesSaved ?? 0) < 2).map((e) => e.name);

      if (missing.length > 0) {
        throw new Error(`alternate over strip halves needs a saved segment count (>= 2) for ${missing.join(", ")} (fix: paint stripes, count the bands, save the count)`);
      }
    }

    const speedMs = Math.min(5000, Math.max(40, Math.round(opts.speedMs)));

    if (opts.effect !== undefined && isBeatEffect(opts.effect) && opts.bpm === undefined) {
      throw new Error(`effect ${opts.effect} needs a tempo (fix: tap the tempo in the Party card, or start the mic overlay)`);
    }

    const bpm = opts.bpm !== undefined ? Math.min(300, Math.max(40, Math.round(opts.bpm))) : undefined;

    void this.stopAlternate();
    const timer = setInterval(() => { void this.alternateStep(); }, speedMs);

    try {
      timer.unref?.();
    } catch { /* loop lifetime owns the timer */ }

    const state: AlternateStateInternal = { ...opts, ...(bpm !== undefined ? { bpm } : {}), speedMs, timer, phase: false, tick: 0 };
    this.alternate = state;
    // Engage immediately: waiting one interval before the first swap makes
    // the button feel dead.
    void this.alternateStep();

    return { mode: opts.mode, speedMs, fixtures: enabled.length, colours: opts.colours, ...(opts.effect !== undefined ? { effect: opts.effect } : {}), ...(bpm !== undefined ? { bpm } : {}) };
  }

  /** Stop the alternation and settle every enabled fixture back on the
   *  standing colour, so the room is never left mid-swap. */
  async stopAlternate(): Promise<boolean> {
    const cur = this.alternate;

    if (cur === null) return false;
    clearInterval(cur.timer);
    this.alternate = null;

    try {
      for (const entry of this.devices.values()) {
        if (!entry.enabled) continue;
        await this.setColor(entry.mac, cur.colours.a[0], cur.colours.a[1], cur.colours.a[2]);
      }
    } catch (err) {
      this.warn(`alternate restore failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return true;
  }

  alternateStatus(): AlternateReceipt | null {
    const cur = this.alternate;

    if (cur === null) return null;

    return {
      mode: cur.mode, speedMs: cur.speedMs, colours: cur.colours,
      fixtures: [...this.devices.values()].filter((e) => e.enabled).length,
      ...(cur.effect !== undefined ? { effect: cur.effect } : {}),
      ...(cur.bpm !== undefined ? { bpm: cur.bpm } : {}),
    };
  }

  /** Live tempo update for a running party runner (the card's tap tempo, or
   *  the mic estimate from the operator-started Audio sync card). The effect
   *  is not restarted: it keeps its phase and simply re-times. */
  setAlternateBpm(bpm: number): boolean {
    const cur = this.alternate;

    if (cur === null) return false;
    cur.bpm = Math.min(300, Math.max(40, Math.round(bpm)));

    return true;
  }

  private alternateStep(): void {
    const cur = this.alternate;

    if (cur === null) return;
    // A slow step (arming, UDP stalls) must not let the next interval stack
    // on top of it: ticks are skipped, never queued (newest-state-wins).
    if (this.alternateBusy) return;
    this.alternateBusy = true;
    cur.phase = !cur.phase;
    cur.tick += 1;

    void this.alternateApply(cur).finally(() => { this.alternateBusy = false; });
  }

  private async alternateApply(cur: AlternateStateInternal): Promise<void> {

    try {
      const { a, b } = cur.colours;
      const colourFor = (groupA: boolean): [number, number, number] => (groupA !== cur.phase ? a : b);
      const enabled = [...this.devices.values()].filter((e) => e.enabled);

      // Party effects repaint from a palette each tick instead of swapping
      // the two flash colours (LED_PARTY's mode catalog, client-side).
      if (cur.effect !== undefined) {
        const groups = cur.mode === "halves" ? 2 : enabled.length;
        const frame = partyFrame(cur.effect, cur.tick, {
          groups, a, b, palette: cur.palette ?? [], stepMs: cur.speedMs,
          ...(cur.bpm !== undefined ? { beatMs: 60_000 / cur.bpm } : {}),
        });
        const colourAt = (i: number): Rgb => frame[i] ?? a;

        if (cur.mode === "lamps") {
          for (let i = 0; i < enabled.length; i++) {
            const entry = enabled[i];

            if (entry === undefined) continue;
            const colour = colourAt(i);

            await this.setColor(entry.mac, colour[0], colour[1], colour[2]);
          }

          return;
        }

        for (const entry of enabled) {
          const zones = entry.zonesSaved ?? 0;

          if (zones < 2) continue;
          const mid = Math.floor(zones / 2);
          const low = colourAt(0);
          const high = colourAt(1);

          await this.paintRange(entry.mac, 0, mid - 1, low[0], low[1], low[2]);
          await this.paintRange(entry.mac, mid, zones - 1, high[0], high[1], high[2]);
        }

        return;
      }

      if (cur.mode === "lamps") {
        for (let i = 0; i < enabled.length; i++) {
          const colour = colourFor(i % 2 === 0);
          const entry = enabled[i];

          if (entry === undefined) continue;
          await this.setColor(entry.mac, colour[0], colour[1], colour[2]);
        }

        return;
      }

      for (const entry of enabled) {
        const zones = entry.zonesSaved ?? 0;

        if (zones < 2) continue;
        const mid = Math.floor(zones / 2);
        const low = colourFor(true);
        const high = colourFor(false);

        await this.paintRange(entry.mac, 0, mid - 1, low[0], low[1], low[2]);
        await this.paintRange(entry.mac, mid, zones - 1, high[0], high[1], high[2]);
      }
    } catch (err) {
      this.warn(`alternate step failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  closeStream(mac: string): void {
    const entry = this.devices.get(mac);

    if (!entry) return;
    this.teardownStream(entry);
    entry.streamDesired = false;
  }

  // -- power -------------------------------------------------------------------

  /** Turn a fixture's power on/off over LAN and drop stale arming. After a
   *  physical switch-off the fixture no longer honors razer frames, but the
   *  manager may still believe it is armed; clearing that (with the stream)
   *  makes the next paint re-arm and repaint the fixture instead of writing
   *  frames into the dark. */
  async setPower(mac: string, on: boolean): Promise<{ mac: string; on: boolean }> {
    await this.start();
    const entry = this.require(mac);

    await this.enqueue(entry.mac, async () => {
      await this.spaced(entry);
      this.sendJson(entry.mac, turnCommand(on));
      entry.armed = false;
      this.closeStream(entry.mac);
    });

    this.saveRegistrySoon();
    // Refresh the observed on/off state (and rtt) if the fixture answers; the
    // receipt does not wait on it.
    void this.requestDevStatus(entry.mac, { retryMs: 200, deadlineMs: 600, quiet: true }).catch(() => undefined);

    return { mac: entry.mac, on };
  }

  // -- blackout, white, brightness (T-GOV-09) -------------------------------------

  async blackout(mac: string): Promise<void> {
    await this.start();
    const entry = this.require(mac);
    const zones = entry.zones ?? (entry.lastFrame ? Math.floor(entry.lastFrame.length / 3) : 0);

    if (zones <= 0) {
      entry.pendingBlackout = true;

      return;
    }

    if (!entry.stream || entry.streamClosed) {
      await this.openStream(mac, { zones });
    }

    const live = this.require(mac);

    if (!live.stream || live.streamClosed) {
      live.pendingBlackout = true;

      return;
    }

    // Zeros go out on the wire now (blackout latency) and into the paced
    // stream (cancels any pending stale frame, keeps the channel armed).
    const zeros = blackoutPayload(live.zones ?? zones);
    this.sendRaw(mac, paint(zeros));
    live.lastFrame = zeros.slice();

    try {
      live.stream.setAll(zeros);
    } catch { /* zones raced; the direct zeros already went out */ }
  }

  async blackoutAll(): Promise<void> {
    await this.start();

    for (const mac of this.devices.keys()) {
      await this.blackout(mac);
    }
  }

  async whiteHit(mac: string, intensity: number): Promise<void> {
    await this.start();
    const entry = this.require(mac);
    const zones = entry.zones ?? (entry.lastFrame ? Math.floor(entry.lastFrame.length / 3) : 0);

    if (zones <= 0) {
      throw new Error(`whiteHit needs known zones for ${mac} (fix: openStream or setZones first)`);
    }

    if (!entry.stream || entry.streamClosed) {
      await this.openStream(mac, { zones });
    }

    const live = this.require(mac);

    if (!live.stream) throw new Error(`whiteHit lost the stream for ${mac} (fix: retry once)`);
    const frame = whiteHitPayload(live.zones ?? zones, intensity);
    live.lastFrame = frame.slice();
    live.stream.setAll(frame);
  }

  async setBrightness(mac: string, value: number): Promise<void> {
    await this.start();
    const entry = this.require(mac);
    const v = Math.min(100, Math.max(1, Math.round(value)));
    entry.requestedBrightness = v;
    entry.generation += 1;
    const gapMs = 60000 / this.o.brightnessMaxPerMinute;
    const now = this.clock();

    if (now - entry.lastBrightnessSentMs >= gapMs && entry.brightnessTimer === null) {
      await this.sendBrightnessNow(entry, v);

      return;
    }

    entry.pendingBrightness = v;

    if (entry.brightnessTimer === null) {
      const delay = Math.max(0, gapMs - (now - entry.lastBrightnessSentMs));
      entry.brightnessTimer = setTimeout(() => {
        entry.brightnessTimer = null;
        const next = entry.pendingBrightness;
        entry.pendingBrightness = null;

        if (next !== null) void this.sendBrightnessNow(entry, next);
      }, delay);

      try {
        entry.brightnessTimer.unref?.();
      } catch { /* show lifetime owns the loop */ }
    }
  }

  async dimAll(): Promise<void> {
    await this.start();

    for (const entry of this.devices.values()) {
      await this.sendBrightnessNow(entry, 1);
    }
  }

  disarm(mac: string): void {
    const entry = this.devices.get(mac);

    if (!entry) return;
    this.teardownStream(entry);
  }

  disarmAll(): void {
    for (const entry of this.devices.values()) {
      this.teardownStream(entry);
      entry.streamDesired = false;
    }
  }

  // -- manual lane (T-RUN-07, spec 50): master intents command the rig ------

  /** Solid colour on one fixture. The razer stream is the primary path:
   *  segmented paints snap instantly, where the one-shot colorwc path
   *  cross-fades slowly on these units (owner call, 2026-10-13). Count
   *  priority: the operator-saved count, else the live stream's own size
   *  (whatever the strip is showing now, probe included). Only a fixture
   *  with neither a saved count nor an armed stream falls back to colorwc —
   *  and the fallback is warned with its fix, never silent. Blackout rides
   *  this as RGB 0,0,0 (§47), never turn. */
  async setColor(mac: string, r: number, g: number, b: number): Promise<void> {
    await this.start();
    const entry = this.require(mac);
    const stream = entry.stream;
    const count = entry.zonesSaved ?? (stream && !entry.streamClosed ? stream.zones : null);

    entry.lastColor = [r, g, b];

    if (count !== null && count > 0) {
      try {
        await this.ensureStreamAt(entry.mac, count);
        const live = this.require(entry.mac);
        const frame = solidPayload(count, r, g, b);

        live.lastFrame = frame.slice();
        live.stream?.setAll(frame);

        return;
      } catch (err) {
        this.warn(`razer paint failed for ${entry.mac}, using colorwc: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      this.warn(`no segment count for ${entry.mac}: colorwc fades slowly (fix: count the segments in the console to arm the instant razer path)`);
    }

    this.sendJson(entry.mac, colorCommand(r, g, b));
  }

  /** Manual lane over the enabled rig: per-fixture failures are collected,
   *  never thrown as a batch (one dead lamp must not lose the others). */
  async setColorAll(r: number, g: number, b: number): Promise<ManualReceipt> {
    return this.commandEnabled((mac) => this.setColor(mac, r, g, b));
  }

  async setBrightnessAll(value: number): Promise<ManualReceipt> {
    return this.commandEnabled((mac) => this.setBrightness(mac, value));
  }

  private async commandEnabled(run: (mac: string) => Promise<void>): Promise<ManualReceipt> {
    // The registry is the restart path: a master intent must reach saved
    // fixtures even when no scan has run in this process yet. loadRegistry
    // is idempotent; start() (inside each command) re-runs it harmlessly.
    if (this.devices.size === 0) this.loadRegistry();
    const ok: string[] = [];
    const failed: { mac: string; message: string }[] = [];

    for (const entry of this.devices.values()) {
      if (!entry.enabled) continue;

      try {
        await run(entry.mac);
        ok.push(entry.mac);
      } catch (err) {
        failed.push({ mac: entry.mac, message: err instanceof Error ? err.message : String(err) });
      }
    }

    return { ok, failed };
  }

  /** Rename a fixture: the registry-owned label the venue screen shows. */
  renameDevice(mac: string, name: string): { mac: string; name: string } {
    const entry = this.require(mac);
    const trimmed = name.trim().slice(0, 48);

    if (trimmed.length === 0) throw new Error("rename needs a non-empty name (fix: type a label)");
    entry.name = trimmed;
    this.saveRegistrySoon();

    return { mac: entry.mac, name: entry.name };
  }

  /** Enable/disable a fixture on the rig: disabled fixtures are skipped by
   *  the manual all-commands; identify and test chase still address them. */
  setDeviceEnabled(mac: string, enabled: boolean): { mac: string; enabled: boolean } {
    const entry = this.require(mac);
    entry.enabled = enabled;
    this.saveRegistrySoon();

    return { mac: entry.mac, enabled: entry.enabled };
  }

  // -- registry and health (T-GOV-06) ----------------------------------------------

  backoff(mac: string): void {
    const entry = this.devices.get(mac);

    if (!entry) return;
    const next = Math.max(this.o.backoffMinFps, Math.floor(entry.fps / 2));

    if (next >= entry.fps) return;
    entry.fps = next;

    if (entry.health === "online") entry.health = "degraded";
    const stream = entry.stream;

    if (stream && !entry.streamClosed && stream.rateHz !== next && entry.zones !== null) {
      const zones = entry.zones;
      entry.streamClosed = true;

      try {
        stream.close();
      } catch { /* pacing loop already torn down */ }

      entry.stream = null;
      entry.armed = false;
      void this.openStream(mac, { zones, fps: next });
    }
  }

  registrySnapshot(): DeviceEntrySnapshot[] {
    // The saved rig must be readable before any scan or socket work: the
    // venue screen hydrates from this on mount (restart shows the lights).
    if (this.devices.size === 0) this.loadRegistry();

    return [...this.devices.values()].map((e) => this.snapshot(e));
  }

  deviceMetrics(mac: string): (Omit<DeviceEntrySnapshot, "requested"> & {
    requestedState: { on: boolean; brightness: number; generation: number };
    requested: number;
    sent: number;
    superseded: number;
    missedTicks: number;
    effectiveHz: number;
  }) | null {
    const entry = this.devices.get(mac);

    if (!entry) return null;
    const stream = entry.stream;
    const snap = this.snapshot(entry);
    const { requested: _requestedState, ...rest } = snap;
    void _requestedState;

    return {
      ...rest,
      requestedState: snap.requested,
      requested: stream?.framesRequested ?? 0,
      sent: stream?.framesSent ?? entry.sentFrames,
      superseded: stream?.framesSuperseded ?? 0,
      missedTicks: stream?.missedTicks ?? 0,
      effectiveHz: stream?.rateHz ?? entry.fps,
    };
  }

  // -- IDENTIFY and TEST CHASE transport --------------------------------------------

  async identify(mac: string, opts?: { flashMs?: number }): Promise<IdentifyReceipt> {
    await this.start();
    const entry = this.require(mac);
    const flashMs = Math.max(0, opts?.flashMs ?? this.o.identifyFlashMs);
    const capture = await this.requestDevStatus(mac, { retryMs: 250, deadlineMs: 250 });
    const stream = entry.stream;

    if (entry.armed && stream && !entry.streamClosed && entry.zones !== null) {
      const zones = entry.zones;
      await this.enqueue(entry.mac, async () => {
        this.sendRaw(entry.mac, paint(whiteHitPayload(zones, 1)));
      });
      await this.wait(flashMs);

      const restore = entry.lastFrame && entry.lastFrame.length === zones * 3
        ? entry.lastFrame
        : blackoutPayload(zones);

      await this.enqueue(entry.mac, async () => {
        this.sendRaw(entry.mac, paint(restore));
      });

      return {
        mac,
        address: entry.ip,
        path: "stream",
        restored: entry.lastFrame ? "current-frame" : "blackout-frame",
        observedAnswered: capture.answered,
      };
    }

    const observed = capture.status;
    await this.enqueue(entry.mac, async () => {
      await this.spaced(entry);
      this.sendJson(entry.mac, turnCommand(true));
      await this.spaced(entry);
      this.sendJson(entry.mac, colorCommand(255, 255, 255));
    });
    await this.wait(flashMs);

    if (observed === null) {
      return { mac, address: entry.ip, path: "colorwc", restored: "no-read-back", observedAnswered: false };
    }

    await this.enqueue(entry.mac, async () => {
      await this.spaced(entry);

      if (!observed.onOff) {
        this.sendJson(entry.mac, turnCommand(false));
      } else {
        this.sendJson(entry.mac, brightnessCommand(observed.brightness));
        await this.spaced(entry);
        this.sendJson(entry.mac, colorCommand(observed.color.r, observed.color.g, observed.color.b));
      }
    });

    return { mac, address: entry.ip, path: "colorwc", restored: "observed-state", observedAnswered: true };
  }

  async testChase(mac: string, opts?: { stepMs?: number }): Promise<ChaseReceipt> {
    await this.start();
    const entry = this.require(mac);
    const stepMs = Math.max(0, opts?.stepMs ?? this.o.testChaseStepMs);
    // Only an operator-confirmed count earns the segmented chase; a probe
    // count or a leftover frame length would chase the wrong band count.
    const zones = entry.zonesSaved ?? 0;

    if (zones > 0) {
      if (!entry.stream || entry.streamClosed) {
        await this.openStream(mac, { zones });
      }

      const stream = this.require(mac).stream;

      if (!stream) throw new Error(`testChase lost the stream for ${mac} (fix: retry once)`);
      const order: number[] = [];

      for (let i = 0; i < zones; i++) order.push(i);

      for (let i = zones - 1; i >= 0; i--) order.push(i);

      for (const zone of order) {
        const frame = new Uint8Array(zones * 3);
        frame[zone * 3] = 255;
        frame[zone * 3 + 1] = 255;
        frame[zone * 3 + 2] = 255;
        entry.lastFrame = frame.slice();
        stream.setAll(frame);
        await this.wait(stepMs);
      }

      return { mac, address: entry.ip, path: "stream", steps: order.length };
    }

    const capture = await this.requestDevStatus(mac, { retryMs: 250, deadlineMs: 250 });

    for (const level of [30, 65, 100]) {
      await this.enqueue(entry.mac, async () => {
        await this.spaced(entry);
        this.sendJson(entry.mac, brightnessCommand(level));
      });
      await this.wait(stepMs);
    }

    if (capture.status) {
      const back = capture.status.brightness;
      await this.enqueue(entry.mac, async () => {
        await this.spaced(entry);
        this.sendJson(entry.mac, brightnessCommand(back));
      });
    }

    return { mac, address: entry.ip, path: "brightness-ramp", steps: 3 };
  }

  applyLiveTunables(p: Partial<GoveeManagerOptions>): void {
    const num = (v: number | undefined, min: number): number | null =>
      typeof v === "number" && Number.isFinite(v) ? Math.max(min, v) : null;

    const retryInitial = num(p.retryInitialMs, 100);

    if (retryInitial !== null) {
      this.o.retryInitialMs = retryInitial;
      this.retryDelayMs = Math.min(this.retryDelayMs, retryInitial);
    }

    const retryMax = num(p.retryMaxMs, 1000);

    if (retryMax !== null) this.o.retryMaxMs = retryMax;
    const bg = num(p.backgroundRescanMs, 1000);

    if (bg !== null && bg !== this.o.backgroundRescanMs) {
      this.o.backgroundRescanMs = bg;

      if (this.loopLive) {
        this.stopDiscovery();
        this.startDiscovery();
      }
    }

    const statusRetry = num(p.statusRetryMs, 1);

    if (statusRetry !== null) this.o.statusRetryMs = statusRetry;
    const deadline = num(p.statusDeadlineMs, 1);

    if (deadline !== null) this.o.statusDeadlineMs = deadline;
    const minFps = num(p.backoffMinFps, 1);

    if (minFps !== null) this.o.backoffMinFps = Math.round(minFps);
    const perMin = num(p.brightnessMaxPerMinute, 1);

    if (perMin !== null) this.o.brightnessMaxPerMinute = perMin;
    const flash = num(p.identifyFlashMs, 0);

    if (flash !== null) this.o.identifyFlashMs = flash;
    const step = num(p.testChaseStepMs, 0);

    if (step !== null) this.o.testChaseStepMs = step;

    if (Array.isArray(p.scanList)) this.o.scanList = [...p.scanList];

    if (Array.isArray(p.interfaces)) {
      this.o.interfaces = [...p.interfaces];
      this.lastIfaceSig = "";
      this.retryDelayMs = this.o.retryInitialMs;
    }
  }

  saveRegistryNow(): void {
    const path = this.o.registryPath;

    if (!path) return;

    try {
      mkdirSync(dirname(path), { recursive: true });

      const devices = [...this.devices.values()].map((e) => ({
        mac: e.mac,
        sku: e.sku,
        name: e.name,
        enabled: e.enabled,
        zones: e.zonesSaved,
        ipHistory: e.ipHistory,
        bleHard: e.bleHard,
        bleSoft: e.bleSoft,
        wifiHard: e.wifiHard,
        wifiSoft: e.wifiSoft,
        rung: e.rung,
        lastSeenMs: e.lastSeenMs,
      }));
      const file: LanRegistryFile = { version: 1, devices };

      writeFileSync(path, JSON.stringify(file, null, 2), "utf8");
    } catch (err) {
      this.warn(`registry save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // -- internals ----------------------------------------------------------------------

  private require(mac: string): DeviceEntry {
    const byMac = this.devices.get(mac);

    if (byMac) return byMac;

    for (const entry of this.devices.values()) {
      if (entry.ip === mac) return entry;
    }

    throw new Error(`unknown device ${mac} (fix: scan the LAN first)`);
  }

  private snapshot(e: DeviceEntry): DeviceEntrySnapshot {
    return {
      mac: e.mac,
      sku: e.sku,
      name: e.name,
      enabled: e.enabled,
      ip: e.ip,
      ipInferred: e.ipInferred,
      lastSeenMs: e.lastSeenMs,
      rung: e.rung,
      firmware: e.wifiSoft || e.bleSoft,
      health: e.health,
      fps: e.fps,
      armed: e.armed,
      zones: e.zonesSaved,
      sentFrames: e.stream?.framesSent ?? e.sentFrames,
      supersededFrames: e.stream?.framesSuperseded ?? 0,
      rttMs: e.rttMs,
      consecutiveFailures: e.consecutiveFailures,
      reconnects: e.reconnects,
      disagreeCount: e.disagreeCount,
      observed: e.observed,
      requested: { on: e.requestedOn, brightness: e.requestedBrightness, generation: e.generation },
    };
  }

  private warn(message: string): void {
    this.warnings.push({ at: this.clock(), message });

    if (this.warnings.length > 100) this.warnings.splice(0, this.warnings.length - 100);
  }

  private noteFailure(entry: DeviceEntry, message: string): void {
    entry.consecutiveFailures += 1;
    entry.lastFailureMs = this.clock();
    entry.lastSendError = message;

    if (entry.consecutiveFailures >= 3 && entry.health === "online") entry.health = "degraded";
  }

  private enqueue(mac: string, work: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(mac) ?? Promise.resolve();
    const run = prev.then(work, work);
    this.chains.set(mac, run.then(() => undefined, () => undefined));

    return run;
  }

  private async spaced(entry: DeviceEntry): Promise<void> {
    const gap = this.o.minSpacingMs;

    if (gap <= 0) {
      entry.lastCommandAt = this.clock();

      return;
    }

    const remaining = entry.lastCommandAt + gap - this.clock();

    if (remaining > 0) await this.wait(remaining);
    entry.lastCommandAt = this.clock();
  }

  private wrapStream(entry: DeviceEntry, stream: PacingStream): DeviceStream {
    let closed = false;
    const mac = entry.mac;
    const zones = stream.zones;

    return {
      mac,
      zones,
      get closed() {
        return closed;
      },
      setAll: (frame: Uint8Array) => {
        if (closed || entry.stream !== stream) return;
        entry.lastFrame = frame.slice();
        stream.setAll(frame);
      },
      close: () => {
        if (closed) return;
        closed = true;

        if (entry.stream === stream) {
          entry.stream = null;
          entry.streamClosed = true;
          entry.streamDesired = false;
          entry.armed = false;

          try {
            stream.close();
          } catch { /* pacing loop already torn down */ }

          this.sendJson(mac, envelope(arm(false)));
        }
      },
      metrics: () => ({
        requested: stream.framesRequested,
        sent: stream.framesSent,
        superseded: stream.framesSuperseded,
        missedTicks: stream.missedTicks,
        effectiveHz: stream.rateHz,
      }),
    };
  }

  private teardownStream(entry: DeviceEntry): void {
    const stream = entry.stream;
    entry.stream = null;
    entry.streamClosed = true;
    entry.armed = false;
    this.clearStreamTimers(entry);

    if (stream) {
      try {
        stream.close();
      } catch { /* pacing loop already torn down */ }

      this.sendJson(entry.mac, envelope(arm(false)));
    }
  }

  private clearStreamTimers(entry: DeviceEntry): void {
    if (entry.keepaliveTimer !== null) {
      clearInterval(entry.keepaliveTimer);
      entry.keepaliveTimer = null;
    }

    if (entry.brightnessTimer !== null) {
      clearTimeout(entry.brightnessTimer);
      entry.brightnessTimer = null;
      entry.pendingBrightness = null;
    }
  }

  private armKeepalive(entry: DeviceEntry): void {
    if (entry.keepaliveTimer !== null) {
      clearInterval(entry.keepaliveTimer);
      entry.keepaliveTimer = null;
    }

    if (this.o.keepaliveMs <= 0) return;
    entry.keepaliveTimer = setInterval(() => {
      const stream = entry.stream;
      const frame = entry.lastFrame;

      if (stream && !entry.streamClosed && frame) {
        this.sendRaw(entry.mac, paint(frame));
      }
    }, this.o.keepaliveMs);

    try {
      entry.keepaliveTimer.unref?.();
    } catch { /* show lifetime owns the loop */ }
  }

  private async sendBrightnessNow(entry: DeviceEntry, value: number): Promise<void> {
    await this.enqueue(entry.mac, async () => {
      await this.spaced(entry);
      this.sendJson(entry.mac, brightnessCommand(value));
      entry.lastBrightnessSentMs = this.clock();
    });
  }

  private senderFor(ip: string): { socket: Socket } | null {
    for (const s of this.senders.values()) {
      if (s.address !== null && s.netmask !== null && sameSubnet(ip, s.address, s.netmask)) {
        return s;
      }
    }

    const first = this.senders.values().next();

    if (!first.done) return first.value ?? null;

    return null;
  }

  private eligibleInterfaces(): { name: string; address: string; netmask: string; broadcast: string | null }[] {
    const out: { name: string; address: string; netmask: string; broadcast: string | null }[] = [];
    const all = networkInterfaces();

    for (const name of Object.keys(all)) {
      if (this.o.interfaces.length > 0 && !this.o.interfaces.includes(name)) continue;
      const addrs = all[name];

      if (!addrs) continue;

      for (const a of addrs) {
        if (a.family !== "IPv4") continue;
        const loopback = a.internal || a.address.startsWith("127.");
        const linkLocal = a.address.startsWith("169.254.");

        if (!this.o.loopbackScan && (loopback || linkLocal)) continue;

        if (this.o.loopbackScan && linkLocal) continue;

        if (!isPrivateIpv4(a.address) && !loopback) {
          if (!this.refusedWan.some((r) => r.name === name && r.address === a.address)) {
            this.refusedWan.push({ name, address: a.address });
          }

          continue;
        }

        out.push({ name, address: a.address, netmask: a.netmask, broadcast: directedBroadcast(a.address, a.netmask) });
      }
    }

    return out;
  }

  private openSenders(
    ifaces: { name: string; address: string; netmask: string; broadcast: string | null }[],
  ): void {
    // One send socket per interface, reused for every command and frame
    // (T-GOV-04): the count is fixed at start, never per send.
    const wanted = ifaces.length > 0 ? ifaces : [{ name: "*", address: "", netmask: "", broadcast: null }];

    for (const iface of wanted) {
      const key = iface.address || "*";

      if (this.senders.has(key)) continue;
      const socket = createSocket("udp4");
      socket.on("error", (err: Error) => {
        this.lastError = err.message;
      });

      try {
        socket.setBroadcast(true);
      } catch { /* directed broadcast unavailable; multicast and unicast remain */ }

      try {
        socket.unref?.();
      } catch { /* loop already draining */ }

      this.senders.set(key, {
        socket,
        address: iface.address || null,
        netmask: iface.netmask || null,
      });
    }
  }

  private markRung(rung: DiscoveryRung): void {
    this.marks.push({ rung, at: this.clock() });

    if (this.marks.length > RUNG_MARKS) this.marks.splice(0, this.marks.length - RUNG_MARKS);
  }

  private rungForReply(atMs: number): DiscoveryRung {
    let rung: DiscoveryRung = "background";

    for (const mark of this.marks) {
      if (mark.at <= atMs) rung = mark.rung;
    }

    return rung;
  }

  private async loop(): Promise<void> {
    while (this.loopLive) {
      await this.round();
      await this.wait(this.retryDelayMs);
      this.retryDelayMs = Math.min(this.o.retryMaxMs, this.retryDelayMs * 2);
    }
  }
  private async round(): Promise<void> {
    const sock = this.replySock;

    if (!sock) return;

    if (this.roundInFlight) return;
    this.roundInFlight = true;

    try {
      this.scanRounds += 1;
      const payload = JSON.stringify(SCAN_REQUEST);

      const send = (host: string, port: number): void => {
        try {
          sock.send(payload, port, host, () => undefined);
        } catch { /* unreachable host; next rung covers it */ }
      };

      if (this.o.multicast) {
        this.markRung("multicast");
        const ifaces = this.eligibleInterfaces();

        for (const iface of ifaces) {
          try {
            sock.setMulticastInterface(iface.address);
          } catch { /* default route still sends */ }

          send(MULTICAST, this.o.scanPort);
        }

        if (ifaces.length === 0) send(MULTICAST, this.o.scanPort);
        await this.wait(RUNG_GAP_MS);
      }

      if (this.o.perInterfaceBroadcast) {
        this.markRung("broadcast");

        for (const iface of this.eligibleInterfaces()) {
          if (iface.broadcast) send(iface.broadcast, this.o.scanPort);
        }

        await this.wait(RUNG_GAP_MS);
      }

      if (this.o.globalBroadcast) {
        this.markRung("global");
        send(GLOBAL_BROADCAST, this.o.scanPort);
        await this.wait(RUNG_GAP_MS);
      }

      if (this.o.scanList.length > 0) {
        this.markRung("scan-list");

        for (const target of await this.resolveScanList()) {
          send(target, this.o.scanPort);
        }

        await this.wait(RUNG_GAP_MS);
      }

      const cached = [...this.devices.values()].map((e) => e.ip).filter((ip) => ip !== "");

      if (cached.length > 0) {
        this.markRung("cached-unicast");

        for (const ip of cached) {
          this.scanSentAt.set(ip, this.clock());
          send(ip, this.o.scanPort);
        }
      }

      this.checkInterfaces();
      this.markOffline();
      this.probeRtt();
    } finally {
      this.roundInFlight = false;
    }
  }

  private async resolveScanList(): Promise<string[]> {
    const out: string[] = [];

    for (const entry of this.o.scanList) {
      const host = entry.trim();

      if (!host) continue;

      if (IPV4.test(host)) {
        out.push(host);
        continue;
      }

      try {
        const found = await dns.lookup(host);
        out.push(found.address);
      } catch {
        this.warn(`scan list host ${host} did not resolve (fix: check the name or use an IP)`);
      }
    }

    return out;
  }

  private checkInterfaces(): void {
    const sig = this.eligibleInterfaces().map((i) => `${i.name}=${i.address}`).join(",");

    if (this.lastIfaceSig !== "" && sig !== this.lastIfaceSig) {
      this.retryDelayMs = this.o.retryInitialMs;
    }

    this.lastIfaceSig = sig;
  }

  private markOffline(): void {
    const now = this.clock();

    for (const entry of this.devices.values()) {
      if (entry.health !== "offline" && now - entry.lastSeenMs > this.o.offlineAfterMs) {
        entry.health = "offline";
      }
    }
  }

  // devStatus is the only read-back that measures rtt, and rounds are the only
  // recurring hook. Quiet probes keep a sleeping device's health untouched.
  private probeRtt(): void {
    for (const entry of this.devices.values()) {
      if (entry.ip === "" || entry.health !== "online") continue;

      void this.requestDevStatus(entry.mac, { retryMs: 150, deadlineMs: 250, quiet: true }).catch(() => undefined);
    }
  }

  private deliverToWaiters(senderIp: string, text: string): void {
    let cmd: unknown = null;

    try {
      cmd = (JSON.parse(text) as { msg?: { cmd?: unknown } }).msg?.cmd ?? null;
    } catch {
      cmd = null;
    }

    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const waiter = this.waiters[i];

      if (!waiter) continue;

      if (waiter.want === "devStatus" && cmd !== "devStatus") continue;

      if (waiter.ips.has(senderIp)) {
        clearTimeout(waiter.timer);
        this.waiters.splice(i, 1);
        waiter.resolve(text);
      }
    }
  }

  private touchSender(senderIp: string, atMs: number): void {
    for (const entry of this.devices.values()) {
      if (entry.ip === senderIp || entry.ipHistory.includes(senderIp)) {
        entry.lastSeenMs = atMs;
        entry.consecutiveFailures = 0;
        entry.lastSuccessMs = atMs;

        if (entry.health === "offline") {
          entry.health = "online";
          this.onReappear(entry);
        } else if (entry.health !== "degraded") {
          entry.health = "online";
        }

        return;
      }
    }
  }

  private handleMessage(msg: Buffer, rinfo: RemoteInfo): void {
    const text = msg.toString("utf8");
    const atMs = this.clock();
    this.deliverToWaiters(rinfo.address, text);
    let raw: LanInbound = null;

    try {
      raw = JSON.parse(text);
    } catch {
      return;
    }

    if (typeof raw !== "object" || raw === null) return;
    const envelopeMsg = raw as { msg?: { cmd?: unknown; data?: unknown } };
    const cmd = envelopeMsg.msg?.cmd;
    const data = envelopeMsg.msg?.data as Record<string, unknown> | undefined;

    if (cmd === "devStatus" && data) {
      const parsed = parseDevStatus(raw);

      if (parsed) {
        for (const entry of this.devices.values()) {
          if (entry.ip === rinfo.address || entry.ipHistory.includes(rinfo.address)) {
            entry.observed = parsed;
            entry.rttMs = null;
            entry.lastSeenMs = atMs;
            entry.consecutiveFailures = 0;
            entry.lastSuccessMs = atMs;

            if (entry.health === "offline") {
              entry.health = "online";
              this.onReappear(entry);
            } else {
              entry.health = "online";
            }

            this.saveRegistrySoon();
            break;
          }
        }
      }

      return;
    }

    if (cmd === "status" && data) {
      this.touchSender(rinfo.address, atMs);

      return;
    }

    if (data && typeof data["device"] === "string" && typeof data["sku"] === "string") {
      this.noteScanData(data, rinfo.address, atMs);
    }
  }

  private noteScanData(data: Record<string, unknown>, senderIp: string, atMs: number): void {
    const mac = data["device"] as string;
    const claimedIp = typeof data["ip"] === "string" ? (data["ip"] as string) : null;
    const ip = claimedIp ?? senderIp;
    const inferred = claimedIp === null;

    if (claimedIp !== null && claimedIp !== senderIp) {
      this.warn(
        `device ${mac} claims ip ${claimedIp} but the reply came from ${senderIp} ` +
        `(govee2mqtt issue 437: trusting the sender; fix: check for IP conflicts)`,
      );
    }

    const rung = this.rungForReply(atMs);
    const existing = this.devices.get(mac);
    // A reply to our unicast scan measures this device's round trip; stale
    // send times (device missed that rung) are ignored.
    const scanSent = this.scanSentAt.get(senderIp);

    if (scanSent !== undefined) this.scanSentAt.delete(senderIp);

    const scanRttMs = scanSent !== undefined && atMs - scanSent < 2000 ? atMs - scanSent : null;

    if (existing) {
      // Age before this reply lands: it distinguishes a device that was
      // really away (stream dead — recover) from one that merely missed a
      // poll while streaming (re-arming would visibly flash the fixture).
      const gapMs = atMs - existing.lastSeenMs;

      if (scanRttMs !== null) existing.rttMs = scanRttMs;
      if (claimedIp !== null && claimedIp !== senderIp) existing.disagreeCount += 1;

      if (existing.ip !== ip) {
        existing.ip = ip;
        existing.ipHistory = [ip, ...existing.ipHistory.filter((h) => h !== ip)].slice(0, IP_HISTORY);
      }

      existing.lastSeenMs = atMs;
      existing.rung = rung;
      existing.ipInferred = inferred;
      existing.consecutiveFailures = 0;
      existing.lastSuccessMs = atMs;
      const wasOffline = existing.health === "offline";

      if (wasOffline) {
        existing.health = "online";

        // Only a multi-poll absence re-arms; see gapMs above.
        if (gapMs > this.o.offlineAfterMs * 2) this.onReappear(existing);
      } else if (existing.health !== "degraded") {
        existing.health = "online";
      }

      // A name still equal to its MAC was never chosen by anyone: adopt the
      // model default when one exists, so rescans fill in "Strip lights".
      const adopted = defaultDeviceName(data["sku"] as string, mac);

      if (adopted !== mac && existing.name === existing.mac) {
        existing.name = adopted;
      }

      this.saveRegistrySoon();

      return;
    }

    const entry: DeviceEntry = {
      mac,
      sku: data["sku"] as string,
      name: defaultDeviceName(data["sku"] as string, mac),
      enabled: true,
      ip,
      ipHistory: [ip],
      ipInferred: inferred,
      bleHard: typeof data["bleVersionHard"] === "string" ? (data["bleVersionHard"] as string) : "",
      bleSoft: typeof data["bleVersionSoft"] === "string" ? (data["bleVersionSoft"] as string) : "",
      wifiHard: typeof data["wifiVersionHard"] === "string" ? (data["wifiVersionHard"] as string) : "",
      wifiSoft: typeof data["wifiVersionSoft"] === "string" ? (data["wifiVersionSoft"] as string) : "",
      lastSeenMs: atMs,
      rung,
      firmware: "",
      health: "online",
      fps: this.o.fallbackHz,
      armed: false,
      zones: null,
      zonesSaved: null,
      lastColor: null,
      sentFrames: 0,
      supersededFrames: 0,
      rttMs: scanRttMs,
      consecutiveFailures: 0,
      reconnects: 0,
      disagreeCount: claimedIp !== null && claimedIp !== senderIp ? 1 : 0,
      observed: null,
      requestedOn: false,
      requestedBrightness: 100,
      generation: 0,
      stream: null,
      streamClosed: true,
      streamDesired: false,
      lastFrame: null,
      pendingBlackout: false,
      lastCommandAt: 0,
      lastBrightnessSentMs: 0,
      pendingBrightness: null,
      brightnessTimer: null,
      keepaliveTimer: null,
      rearmAt: [],
      lastSendError: null,
      lastSuccessMs: atMs,
      lastFailureMs: 0,
    };

    entry.firmware = entry.wifiSoft || entry.bleSoft;
    this.devices.set(mac, entry);
    this.saveRegistrySoon();
  }

  private onReappear(entry: DeviceEntry): void {
    if (!entry.streamDesired) return;
    const now = this.clock();
    entry.rearmAt = entry.rearmAt.filter((t) => now - t < this.o.rearmWindowMs);

    if (entry.rearmAt.length >= this.o.maxRearmAttempts) {
      this.warn(`device ${entry.mac} reappeared but the re-arm budget is spent (fix: retry later)`);

      return;
    }

    entry.rearmAt.push(now);
    entry.reconnects += 1;
    const zones = entry.zones ?? (entry.lastFrame ? Math.floor(entry.lastFrame.length / 3) : 0);

    if (zones <= 0) return;
    const started = this.clock();
    void (async () => {
      const stream = entry.stream;

      if (stream && !entry.streamClosed) {
        entry.streamClosed = true;

        try {
          stream.close();
        } catch { /* pacing loop already torn down */ }

        entry.stream = null;
      }

      entry.armed = false;
      await this.ensureArmed(entry.mac);

      if (this.clock() - started > this.o.reconnectMaxMs) {
        this.warn(`device ${entry.mac} re-armed slower than govee.lan.reconnect.maxMs`);
      }

      await this.openStream(entry.mac, { zones, fps: entry.fps });
    })();
  }

  private loadRegistry(): void {
    const path = this.o.registryPath;

    if (!path || !existsSync(path)) return;

    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as {
        devices?: {
          mac?: unknown; sku?: unknown; name?: unknown; enabled?: unknown; zones?: unknown; ipHistory?: unknown;
          bleHard?: unknown; bleSoft?: unknown; wifiHard?: unknown; wifiSoft?: unknown;
          lastSeenMs?: unknown;
        }[];
      };

      for (const row of raw.devices ?? []) {
        if (typeof row.mac !== "string" || typeof row.sku !== "string") continue;
        // Newest-state-wins (§49): the file seeds devices; a row already in
        // memory (scanned, renamed, enabled) is never clobbered by the file.
        if (this.devices.has(row.mac)) continue;

        const history = Array.isArray(row.ipHistory)
          ? row.ipHistory.filter((h): h is string => typeof h === "string").slice(0, IP_HISTORY)
          : [];

        const entry: DeviceEntry = {
          mac: row.mac,
          sku: row.sku,
          name: typeof row.name === "string" ? row.name : row.mac,
          enabled: row.enabled !== false,
          ip: history[0] ?? "",
          ipHistory: history,
          ipInferred: false,
          bleHard: typeof row.bleHard === "string" ? row.bleHard : "",
          bleSoft: typeof row.bleSoft === "string" ? row.bleSoft : "",
          wifiHard: typeof row.wifiHard === "string" ? row.wifiHard : "",
          wifiSoft: typeof row.wifiSoft === "string" ? row.wifiSoft : "",
          lastSeenMs: typeof row.lastSeenMs === "number" ? row.lastSeenMs : 0,
          rung: "cached-unicast",
          firmware: "",
          health: "offline",
          fps: this.o.fallbackHz,
          armed: false,
          zones: typeof row.zones === "number" && row.zones > 0 ? row.zones : null,
          zonesSaved: typeof row.zones === "number" && row.zones > 0 ? row.zones : null,
          lastColor: null,
          sentFrames: 0,
          supersededFrames: 0,
          rttMs: null,
          consecutiveFailures: 0,
          reconnects: 0,
          disagreeCount: 0,
          observed: null,
          requestedOn: false,
          requestedBrightness: 100,
          generation: 0,
          stream: null,
          streamClosed: true,
          streamDesired: false,
          lastFrame: null,
          pendingBlackout: false,
          lastCommandAt: 0,
          lastBrightnessSentMs: 0,
          pendingBrightness: null,
          brightnessTimer: null,
          keepaliveTimer: null,
          rearmAt: [],
          lastSendError: null,
          lastSuccessMs: 0,
          lastFailureMs: 0,
        };

        entry.firmware = entry.wifiSoft || entry.bleSoft;
        this.devices.set(entry.mac, entry);
      }
    } catch (err) {
      this.warn(`registry load failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private saveRegistrySoon(): void {
    if (!this.o.registryPath || this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveRegistryNow();
    }, SAVE_THROTTLE_MS);

    try {
      this.saveTimer.unref?.();
    } catch { /* save still lands on process exit paths */ }
  }
}

interface LanRegistryFile {
  version: 1;
  devices: {
    mac: string;
    sku: string;
    name: string;
    enabled: boolean;
    zones: number | null;
    ipHistory: string[];
    rung: DiscoveryRung;
    lastSeenMs: number;
  }[];
}

export function registryFilePath(userDataDir: string): string {
  return join(userDataDir, "govee-registry.json");
}

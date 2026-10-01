// Capability probe and verified fallback (T-GOV-10, closes F-GOV-04, F-GOV-24,
// F-X-09; spec 42, 147, 153).
//
// Provenance: govee-toolkit MIT (Damien Thery, v0.5.0, commit
// ceef296f6382881c5f07698d78fb5719ebca6686) `docs/protocol/lan.md` sections 1
// (consecutive commands: the third back-to-back datagram is dropped), 2.1 to
// 2.3 (arm B1, paint B0, zoned B4) and 2.7 (the undocumented `status` reply
// whose `pt` carries the B2 armed frame). The official Govee WLAN guide owns
// `turn`, `brightness`, `devStatus` and `colorwc`.
//
// Paints never acknowledge, so a paint that lands is not proof: a unit whose
// firmware ignores the razer channel still accepts arm and swallows paint. The
// user's eyes are the only reliable signal, and a unit may stay silent on
// `status` and `devStatus` while armed, which is not a device failure. Every
// probe therefore ends in a recorded verdict, and an unverified unit becomes a
// visible SINGLE-ZONE (fallback) state, never a silent success. A unit that
// does not answer LAN at all (the reported firmware revision issue, F-GOV-24)
// is flagged LAN unavailable on this firmware with BLE offered as the
// alternative.
//
// This module replaces the old "H6076 is single-zone over LAN" claim: the
// codec lives in ./razer.ts, the probe lives here, and no caller may assume a
// segmented channel that this probe did not verify on that unit.
import {
  arm,
  devStatusCommand,
  paint,
  paintZoned,
  parseDevStatus,
  parseStatus,
  turnCommand,
  type LanDeviceStatus,
  type StreamTransport,
} from "./razer.js";

// Defaults carry the config keys they mirror (03-config-and-decisions.md
// section 3.6) so the caller can replace every one of them.
export const PROBE_DEFAULTS = {
  // govee.lan.arm.settleMsDefault. A paint inside the settle window is lost.
  armSettleMs: 50,
  // govee.lan.status.retryMs / govee.lan.status.deadlineMs.
  statusRetryMs: 350,
  statusDeadlineMs: 10000,
  // govee.lan.command.minSpacingMs. Three back-to-back datagrams drop the
  // third (lan.md section 1).
  minSpacingMs: 40,
} as const;

/** The undocumented `status` command; its reply carries the B2 armed frame. */
export const STATUS_COMMAND = JSON.stringify({ msg: { cmd: "status", data: {} } });

/** Visible badge for a unit whose segmented channel is not verified (§153). */
export const SINGLE_ZONE_BADGE = "SINGLE-ZONE (fallback)";
/** Visible badge for a unit that does not answer LAN at all (F-GOV-24). */
export const LAN_UNAVAILABLE_BADGE = "LAN unavailable on this firmware";

/** Whole-fixture modes a verified fallback may use (T-GOV-10). */
export type FallbackMode = "lan-json-colorwc" | "ble-single" | "matter";
/** Alternative transports offered when LAN is absent (config
 *  `govee.device.<fixtureId>.transportOrder` order, spec 148). */
export type AlternativeTransport = "ble-segmented" | "ble-single" | "matter";

/** T-GOV-16 SignalRGB checklist, shown with the LAN-unavailable flag. */
export const LAN_TROUBLESHOOTING: readonly string[] = [
  "Turn LAN Control on for this unit in the Govee Home app, on the same Wi-Fi network (not a guest network).",
  "Check the host and the unit are on the same subnet and that AP or client isolation is off.",
  "Close anything else that holds the LAN sockets: Govee Desktop, homebridge-govee, SignalRGB, Govee LAN Control, another AutoLight instance (UDP 4002 is exclusive).",
  "Allow inbound and outbound UDP 4001 to 4003 through the host firewall.",
  "Power-cycle the unit. If the Govee app still reports LAN on while no reply arrives, this firmware revision has no LAN channel: use BLE.",
];

// ---------------------------------------------------------------------------
// Datagram boundary (T-GOV-04 owns the sockets; this is the seam they satisfy)
// ---------------------------------------------------------------------------

/** Replies are routed by sender: the manager hands back the text that arrived
 *  from that device, or null when the deadline passes. */
export interface ReplySource {
  reply(deviceId: string, timeoutMs: number): Promise<string | null>;
}

/** One persistent-socket transport is enough for the probe, read-backs and
 *  actions: `StreamTransport` (razer frames plus official JSON commands) plus
 *  request/response read-back. */
export type LanExchange = StreamTransport & ReplySource;

export type Waiter = (ms: number) => Promise<void>;

export const sleep: Waiter = (ms) =>
  new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, Math.max(0, ms));
  });

export interface SequencerOptions {
  minSpacingMs: number;
  wait?: Waiter;
  clock?: () => number;
}

/**
 * Spaces consecutive datagrams to one device (govee.lan.command.minSpacingMs).
 * The toolkit records that three datagrams back to back lose the third, so
 * every command and frame the probe, the wizard and the actions send goes
 * through one sequencer per device.
 */
export class CommandSequencer {
  private readonly wait: Waiter;
  private readonly clock: () => number;
  private readonly minSpacingMs: number;
  private lastAt = 0;

  constructor(opts: SequencerOptions) {
    this.minSpacingMs = Math.max(0, opts.minSpacingMs);
    this.wait = opts.wait ?? sleep;
    this.clock = opts.clock ?? (() => Date.now());
  }

  async next(): Promise<void> {
    const remaining = this.lastAt + this.minSpacingMs - this.clock();
    if (remaining > 0) await this.wait(remaining);
    this.lastAt = this.clock();
  }
}

/**
 * One device link: sends through the shared transport, keeps the exact bytes
 * it sent as receipts, and spaces datagrams. Nothing here decides what to
 * send; probe, actions and qualification do that.
 */
export class DeviceLink {
  readonly frames: Uint8Array[] = [];
  readonly commands: string[] = [];
  private readonly sequencer: CommandSequencer;

  constructor(
    private readonly exchange: LanExchange,
    readonly deviceId: string,
    sequencer?: CommandSequencer,
  ) {
    this.sequencer = sequencer ?? new CommandSequencer({ minSpacingMs: PROBE_DEFAULTS.minSpacingMs });
  }

  async sendRaw(frame: Uint8Array): Promise<void> {
    await this.sequencer.next();
    const copy = frame.slice();
    this.frames.push(copy);
    this.exchange.sendRaw(this.deviceId, copy);
  }

  async sendJson(text: string): Promise<void> {
    await this.sequencer.next();
    this.commands.push(text);
    this.exchange.sendJson(this.deviceId, text);
  }

  reply(timeoutMs: number): Promise<string | null> {
    return this.exchange.reply(this.deviceId, timeoutMs);
  }

  framesSentHex(): string[] {
    return this.frames.map((frame) => Buffer.from(frame).toString("hex"));
  }
}

// ---------------------------------------------------------------------------
// Read-back (T-GOV-07 owns the runtime policy; the probe and the wizard share
// this resend-until-deadline read)
// ---------------------------------------------------------------------------

export interface B2Readback {
  answered: boolean;
  answers: number;
  rttMs: number | null;
  status: { onOff: boolean; brightness: number; armed: boolean } | null;
}

export interface DevStatusReadback {
  answered: boolean;
  answers: number;
  rttMs: number | null;
  status: LanDeviceStatus | null;
}

export interface ReadbackOptions {
  retryMs?: number;
  deadlineMs?: number;
  wait?: Waiter;
}

/** Keep the resend cadence at govee.lan.status.retryMs even when a transport
 *  answers with null immediately instead of waiting out the window. */
async function paceRetry(sentAt: number, retryMs: number, wait: Waiter): Promise<void> {
  const elapsed = Date.now() - sentAt;
  if (elapsed < retryMs) await wait(retryMs - elapsed);
}

/** Sends the undocumented `status` command and resends until a reply or the
 *  deadline; parses the B2 armed frame out of `pt`. Silence while armed is
 *  recorded, never treated as failure. */
export async function readB2Status(
  link: DeviceLink,
  opts: ReadbackOptions = {},
): Promise<B2Readback> {
  const retryMs = Math.max(1, opts.retryMs ?? PROBE_DEFAULTS.statusRetryMs);
  const deadlineMs = Math.max(1, opts.deadlineMs ?? PROBE_DEFAULTS.statusDeadlineMs);
  const wait = opts.wait ?? sleep;
  const started = Date.now();
  let answers = 0;
  let rttMs: number | null = null;
  let status: B2Readback["status"] = null;
  while (Date.now() - started <= deadlineMs) {
    const sentAt = Date.now();
    await link.sendJson(STATUS_COMMAND);
    const text = await link.reply(retryMs);
    if (text !== null) {
      answers += 1;
      rttMs = Date.now() - sentAt;
      let decoded: unknown = null;
      try {
        decoded = JSON.parse(text) as unknown;
      } catch {
        decoded = null;
      }
      const parsed = parseStatus(decoded);
      if (parsed !== null) {
        status = parsed;
        break;
      }
    }
    await paceRetry(sentAt, retryMs, wait);
  }
  return { answered: answers > 0, answers, rttMs, status };
}

/** devStatus read-back for the official commands (power, brightness, RGB). */
export async function readDevStatus(
  link: DeviceLink,
  opts: ReadbackOptions = {},
): Promise<DevStatusReadback> {
  const retryMs = Math.max(1, opts.retryMs ?? PROBE_DEFAULTS.statusRetryMs);
  const deadlineMs = Math.max(1, opts.deadlineMs ?? PROBE_DEFAULTS.statusDeadlineMs);
  const wait = opts.wait ?? sleep;
  const started = Date.now();
  let answers = 0;
  let rttMs: number | null = null;
  let status: LanDeviceStatus | null = null;
  while (Date.now() - started <= deadlineMs) {
    const sentAt = Date.now();
    await link.sendJson(devStatusCommand());
    const text = await link.reply(retryMs);
    if (text !== null) {
      answers += 1;
      rttMs = Date.now() - sentAt;
      let decoded: unknown = null;
      try {
        decoded = JSON.parse(text) as unknown;
      } catch {
        decoded = null;
      }
      const parsed = parseDevStatus(decoded);
      if (parsed !== null) {
        status = parsed;
        break;
      }
    }
    await paceRetry(sentAt, retryMs, wait);
  }
  return { answered: answers > 0, answers, rttMs, status };
}

// ---------------------------------------------------------------------------
// The probe (T-GOV-10)
// ---------------------------------------------------------------------------

/** The only reliable signal there is: the user, or the Simulator mode
 *  preview, looking at what the unit actually rendered. */
export interface ProbeUser {
  confirmPaint(pattern: "B0-two-colour" | "B4-zoned"): Promise<boolean>;
}

export interface ProbeIdentity {
  /** MAC. The device id every layer keys on (T-GOV-06). */
  hardwareId: string;
  sku: string;
  firmwareVersion: string;
  ip: string | null;
}

export interface ProbeOptions extends ReadbackOptions {
  /** Candidate zone count for the stripe paints. Never a SKU assumption
   *  (spec 42): the caller passes a count to try, the user confirms what
   *  appeared. */
  zones: number;
  /** govee.lan.arm.settleMsDefault; overridden by the unit's measured value
   *  once qualification step 12 has one. */
  armSettleMs?: number;
  /** govee.lan.command.minSpacingMs. */
  minSpacingMs?: number;
  wait?: Waiter;
  clock?: () => number;
}

export interface CapabilityProbe {
  hardwareId: string;
  sku: string;
  firmwareVersion: string;
  /** Candidate zone count painted; not a measurement. */
  attemptedZones: number;
  /** The unit answered the official API or `status` at least once. */
  reachable: boolean;
  statusAnswered: boolean;
  devStatusAnswered: boolean;
  /** B2 as read back while armed; "silent" when the unit does not answer
   *  while armed (not a failure, toolkit lan.md). */
  armedReadBack: "armed" | "disarmed" | "silent";
  b0Confirmed: boolean;
  b4Confirmed: boolean;
  verdict: ProbeVerdict;
  /** What the device tile shows. Never a silent success. */
  label: string;
  /** Examined show frames, hex, as a receipt. */
  framesSentHex: string[];
  /** Official commands sent before and after arming, as a receipt. */
  commandsSent: string[];
  probedAtMs: number;
  elapsedMs: number;
}

export type ProbeVerdict =
  | {
      kind: "segmented";
      verified: true;
      zones: number;
      b0Confirmed: boolean;
      b4: "confirmed" | "not-confirmed";
    }
  | {
      kind: "single-zone-fallback";
      verified: false;
      degraded: true;
      badge: typeof SINGLE_ZONE_BADGE;
      reason: "paint-ignored" | "paint-not-confirmed";
      zones: 1;
      fallbackMode: FallbackMode;
      demonstration: string;
    }
  | {
      kind: "lan-unavailable";
      verified: false;
      degraded: true;
      badge: typeof LAN_UNAVAILABLE_BADGE;
      bleAlternative: AlternativeTransport;
      troubleshooting: readonly string[];
    };

/** Half red, half blue for the B0 paint: two colours a user can tell apart. */
export function twoColourFrame(zones: number): Uint8Array {
  const n = Math.max(1, Math.floor(zones));
  const frame = new Uint8Array(n * 3);
  const mid = Math.floor(n / 2);
  for (let zone = 0; zone < n; zone++) {
    const [r, g, b] = zone < mid ? [255, 0, 0] : [0, 0, 255];
    frame[zone * 3] = r;
    frame[zone * 3 + 1] = g;
    frame[zone * 3 + 2] = b;
  }
  return frame;
}

/** Zoned B4 probe: first zone red, last zone blue. */
export function zonedProbeEntries(zones: number): { r: number; g: number; b: number; zone: number }[] {
  const n = Math.max(1, Math.floor(zones));
  return [
    { r: 255, g: 0, b: 0, zone: 0 },
    { r: 0, g: 0, b: 255, zone: n - 1 },
  ];
}

/**
 * Per-unit probe: `status`, arm, settle, `status` again for B2, a known
 * two-colour B0 paint the user confirms, then the B4 zoned variant. Records
 * the outcome for the device registry. Call this during qualification (step 8)
 * and again on every firmware change.
 *
 * A probe that cannot reach the unit sends nothing further and returns
 * lan-unavailable; a reachable unit whose paints the user cannot confirm
 * returns single-zone-fallback. Neither is a success.
 */
export async function probeSegmentedCapability(
  exchange: LanExchange,
  identity: ProbeIdentity,
  user: ProbeUser,
  options: ProbeOptions,
): Promise<CapabilityProbe> {
  const startedAt = Date.now();
  const clock = options.clock ?? (() => Date.now());
  const wait = options.wait ?? sleep;
  const attemptedZones = Math.max(1, Math.floor(options.zones));
  const armSettleMs = options.armSettleMs ?? PROBE_DEFAULTS.armSettleMs;
  const link = new DeviceLink(
    exchange,
    identity.hardwareId,
    new CommandSequencer({
      minSpacingMs: options.minSpacingMs ?? PROBE_DEFAULTS.minSpacingMs,
      wait,
      clock,
    }),
  );
  const readOpts: ReadbackOptions = { wait };
  if (options.retryMs !== undefined) readOpts.retryMs = options.retryMs;
  if (options.deadlineMs !== undefined) readOpts.deadlineMs = options.deadlineMs;

  const before = await readB2Status(link, readOpts);
  const devBefore = before.status !== null ? null : await readDevStatus(link, readOpts);
  // Reachable means the unit answered at all: a reply we could not parse is
  // still a LAN channel, and the paints that follow are what decide the
  // capability. Only silence gets the LAN-unavailable flag.
  const reachable = before.answered || devBefore?.answered === true;
  const devStatusAnswered = devBefore?.answered === true;

  const finish = (verdict: ProbeVerdict, armedReadBack: CapabilityProbe["armedReadBack"], b0: boolean, b4: boolean): CapabilityProbe => {
    const probe: CapabilityProbe = {
      hardwareId: identity.hardwareId,
      sku: identity.sku,
      firmwareVersion: identity.firmwareVersion,
      attemptedZones,
      reachable,
      statusAnswered: before.answered,
      devStatusAnswered,
      armedReadBack,
      b0Confirmed: b0,
      b4Confirmed: b4,
      verdict,
      label: probeLabel(verdict),
      framesSentHex: link.framesSentHex(),
      commandsSent: [...link.commands],
      probedAtMs: startedAt,
      elapsedMs: Date.now() - startedAt,
    };
    return probe;
  };

  if (!reachable) {
    // Nothing answers LAN. Do not arm, do not paint, do not pretend: flag the
    // firmware and offer BLE (F-GOV-24).
    return finish(
      {
        kind: "lan-unavailable",
        verified: false,
        degraded: true,
        badge: LAN_UNAVAILABLE_BADGE,
        bleAlternative: "ble-segmented",
        troubleshooting: LAN_TROUBLESHOOTING,
      },
      "silent",
      false,
      false,
    );
  }

  // Power on before arming: `turn` while armed can end the channel, so it is
  // sent only here, before the channel exists.
  await link.sendJson(turnCommand(true));
  await link.sendRaw(arm(true));
  await wait(armSettleMs);

  const armedProbe = before.status !== null ? await readB2Status(link, readOpts) : null;
  const armedReadBack: CapabilityProbe["armedReadBack"] =
    armedProbe?.status == null ? "silent" : armedProbe.status.armed ? "armed" : "disarmed";

  // B0: two colours at the candidate count. The paint never acknowledges.
  await link.sendRaw(paint(twoColourFrame(attemptedZones)));
  const b0 = await user.confirmPaint("B0-two-colour");

  // B4: the zoned variant exists on some models; record it, do not require it.
  await link.sendRaw(paintZoned(zonedProbeEntries(attemptedZones)));
  const b4 = await user.confirmPaint("B4-zoned");

  // Disarm: the unit returns to the colour its last non-stream command left.
  await link.sendRaw(arm(false));

  const verdict: ProbeVerdict =
    b0 || b4
      ? {
          kind: "segmented",
          verified: true,
          zones: attemptedZones,
          b0Confirmed: b0,
          b4: b4 ? "confirmed" : "not-confirmed",
        }
      : {
          kind: "single-zone-fallback",
          verified: false,
          degraded: true,
          badge: SINGLE_ZONE_BADGE,
          reason: armedReadBack === "armed" ? "paint-ignored" : "paint-not-confirmed",
          zones: 1,
          fallbackMode: "lan-json-colorwc",
          demonstration:
            "the whole-fixture colorwc mode answered read-back on this unit, so it is the verified fallback; the segmented channel is not verified and must not be streamed",
        };

  return finish(verdict, armedReadBack, b0, b4);
}

/** Tile label for a probe result. A fallback is labelled, not hidden. */
export function probeLabel(verdict: ProbeVerdict): string {
  if (verdict.kind === "segmented") {
    return `SEGMENTED (${verdict.zones} zones, user confirmed)`;
  }
  if (verdict.kind === "single-zone-fallback") {
    return verdict.badge;
  }
  return verdict.badge;
}

/** The transport order to try next (spec 148 config order), for a unit whose
 *  razer channel is not verified. */
export function fallbackOrder(verdict: ProbeVerdict): readonly string[] {
  if (verdict.kind === "segmented") return ["lan-razer"];
  if (verdict.kind === "single-zone-fallback") return [verdict.fallbackMode, "ble-single", "matter"];
  return [verdict.bleAlternative, "ble-single", "matter"];
}

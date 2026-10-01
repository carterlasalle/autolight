// IDENTIFY, TEST CHASE, RECALIBRATE and the identify walk (T-GOV-12, closes
// F-GOV-10; spec 99).
//
// Provenance: govee-toolkit MIT (Damien Thery, v0.5.0, commit
// ceef296f6382881c5f07698d78fb5719ebca6686): the `Govee.identify` pattern
// lights one device at a time so the user can name and place it. The razer
// channel is where a live stream lives, so IDENTIFY flashes rgb white through
// the stream (B0) when the unit is armed and through the official `colorwc`
// command otherwise: a white `colorwc` while armed can end the channel, and
// `turn` while armed can too (lan.md section 1, spec 46 and 48).
//
// TEST CHASE walks one zone from the venue start end to the other and back at
// `govee.testChase.stepMs` through the stream at the qualified resolution. A
// verified single-zone fixture, which has no zones to walk, gets a three-step
// brightness ramp in RGB instead: LAN has no per-segment dimmer, so intensity
// is linear-light RGB scaling (spec 49).
//
// RECALIBRATE opens the qualification wizard (./qualification.ts) at a chosen
// step. This module never edits wizard state directly: it takes anything that
// can `enterAt(step)`, so the wizard owns the state machine and the UI owns
// the click.
import {
  brightnessCommand,
  colorCommand,
  paint,
  turnCommand,
} from "./razer.js";
import { whiteHitPayload } from "./index.js";
import {
  CommandSequencer,
  DeviceLink,
  PROBE_DEFAULTS,
  readDevStatus,
  sleep,
  type LanExchange,
  type Waiter,
} from "./probe.js";

/** What an action needs to know about the unit: its identity and its qualified
 *  capability. The T-GOV-10 probe decides `capability` and the wizard decides
 *  `zones` and `orientation`; neither is ever assumed from the SKU. */
export interface ActionFixture {
  hardwareId: string;
  /** Qualified zone count; 1 for a verified single-zone fallback. */
  zones: number;
  capability: "segmented" | "single-zone";
  /** Qualified orientation: which physical end is index 0. */
  orientation: "forward" | "reverse";
  /** Whether the unit currently holds an armed razer channel. */
  armed: boolean;
  /** The newest show frame when one exists (`PacingStream.currentFrame`). */
  currentFrame?: Uint8Array | null;
}

export interface ActionOptions {
  /** govee.lan.command.minSpacingMs. */
  minSpacingMs?: number;
  /** One read-back attempt window. Short on purpose: an armed or absent unit
   *  does not stall a user action (a unit may stay silent while armed). */
  captureTimeoutMs?: number;
  wait?: Waiter;
}

function actionLink(exchange: LanExchange, deviceId: string, options: ActionOptions): DeviceLink {
  return new DeviceLink(
    exchange,
    deviceId,
    new CommandSequencer({
      minSpacingMs: options.minSpacingMs ?? PROBE_DEFAULTS.minSpacingMs,
      ...(options.wait !== undefined ? { wait: options.wait } : {}),
    }),
  );
}

// ---------------------------------------------------------------------------
// IDENTIFY
// ---------------------------------------------------------------------------

export interface IdentifyOptions extends ActionOptions {
  /** govee.identify.flashMs. */
  flashMs: number;
}

export interface IdentifyResult {
  action: "identify";
  hardwareId: string;
  /** "stream" when armed (B0 white frame), "colorwc" otherwise. */
  path: "stream" | "colorwc";
  flashMs: number;
  /** What the unit reported before the flash, when it answered at all. */
  observed: { onOff: boolean; brightness: number; r: number; g: number; b: number } | null;
  observedAnswered: boolean;
  observedRttMs: number | null;
  /** How the previous look was put back. */
  restored: "current-frame" | "blackout-frame" | "observed-state" | "no-read-back";
  framesSentHex: string[];
  commandsSent: string[];
  atMs: number;
}

/**
 * Flashes rgb white for `govee.identify.flashMs` and restores the previous
 * look: the current show frame when the stream is armed, otherwise the state
 * the unit reported before the flash. Never sends `turn` while armed, and never
 * sends a white `colorwc` while armed.
 */
export async function identify(
  exchange: LanExchange,
  fixture: ActionFixture,
  options: IdentifyOptions,
): Promise<IdentifyResult> {
  const wait = options.wait ?? sleep;
  const zones = Math.max(1, fixture.zones);
  const link = actionLink(exchange, fixture.hardwareId, options);
  const captureTimeoutMs = Math.max(1, options.captureTimeoutMs ?? 250);
  const atMs = Date.now();

  const capture = await readDevStatus(link, { retryMs: captureTimeoutMs, deadlineMs: captureTimeoutMs });
  const observed = capture.status === null
    ? null
    : {
        onOff: capture.status.onOff,
        brightness: capture.status.brightness,
        r: capture.status.color.r,
        g: capture.status.color.g,
        b: capture.status.color.b,
      };

  let path: IdentifyResult["path"];
  let restored: IdentifyResult["restored"];

  if (fixture.armed) {
    path = "stream";
    await link.sendRaw(paint(whiteHitPayload(zones, 1)));
    await wait(options.flashMs);
    const restoreFrame = fixture.currentFrame ?? null;
    if (restoreFrame !== null) {
      restored = "current-frame";
      await link.sendRaw(paint(restoreFrame));
    } else {
      // No show frame to go back to: stream RGB zeros, never a power command.
      restored = "blackout-frame";
      await link.sendRaw(paint(new Uint8Array(zones * 3)));
    }
  } else {
    path = "colorwc";
    await link.sendJson(colorCommand(255, 255, 255));
    await wait(options.flashMs);
    if (observed === null) {
      restored = "no-read-back";
    } else if (!observed.onOff) {
      restored = "observed-state";
      await link.sendJson(turnCommand(false));
    } else {
      restored = "observed-state";
      await link.sendJson(brightnessCommand(observed.brightness));
      await link.sendJson(colorCommand(observed.r, observed.g, observed.b));
    }
  }

  return {
    action: "identify",
    hardwareId: fixture.hardwareId,
    path,
    flashMs: options.flashMs,
    observed,
    observedAnswered: capture.answered,
    observedRttMs: capture.rttMs,
    restored,
    framesSentHex: link.framesSentHex(),
    commandsSent: [...link.commands],
    atMs,
  };
}

// ---------------------------------------------------------------------------
// TEST CHASE
// ---------------------------------------------------------------------------

export interface ChaseOptions extends ActionOptions {
  /** govee.testChase.stepMs. */
  stepMs: number;
}

/** One zone travels from one end to the other. Pure, so the bytes can be
 *  asserted without a transport. */
export function chaseFrames(zones: number, direction: "forward" | "reverse"): Uint8Array[] {
  const n = Math.max(1, Math.floor(zones));
  const frames: Uint8Array[] = [];
  for (let step = 0; step < n; step++) {
    const zone = direction === "forward" ? step : n - 1 - step;
    const frame = new Uint8Array(n * 3);
    frame[zone * 3] = 255;
    frame[zone * 3 + 1] = 255;
    frame[zone * 3 + 2] = 255;
    frames.push(frame);
  }
  return frames;
}

export interface ChaseResult {
  action: "chase";
  hardwareId: string;
  /** "stream" for a qualified segmented fixture, "ramp" for single-zone. */
  mode: "stream" | "ramp";
  stepMs: number;
  directions: readonly ("forward" | "reverse")[];
  /** The zone lit at each step, in order, for assertions and the UI. */
  zoneOrder: number[];
  frameCount: number;
  framesSentHex: string[];
  commandsSent: string[];
  atMs: number;
}

/**
 * Walks one zone start to end and back at `govee.testChase.stepMs`. On a
 * verified single-zone fixture the same call is a three-step brightness ramp in
 * RGB, because there are no zones to walk.
 */
export async function testChase(
  exchange: LanExchange,
  fixture: ActionFixture,
  options: ChaseOptions,
): Promise<ChaseResult> {
  const wait = options.wait ?? sleep;
  const zones = Math.max(1, fixture.zones);
  const link = actionLink(exchange, fixture.hardwareId, options);
  const atMs = Date.now();

  if (fixture.capability === "single-zone") {
    // Spec 49: intensity is linear-light RGB scaling, never a per-segment
    // dimmer and never the device's white channel (spec 48). While the channel
    // is armed the ramp goes out as stream frames, because any colorwc while
    // armed can end the channel; unarmed it is the whole-fixture command.
    const intensities = [0.25, 0.6, 1] as const;
    for (const intensity of intensities) {
      const white = whiteHitPayload(1, intensity);
      if (fixture.armed) {
        await link.sendRaw(paint(white));
      } else {
        await link.sendJson(colorCommand(white[0] ?? 0, white[1] ?? 0, white[2] ?? 0));
      }
      await wait(options.stepMs);
    }
    return {
      action: "chase",
      hardwareId: fixture.hardwareId,
      mode: "ramp",
      stepMs: options.stepMs,
      directions: [],
      zoneOrder: [],
      frameCount: intensities.length,
      framesSentHex: link.framesSentHex(),
      commandsSent: [...link.commands],
      atMs,
    };
  }

  // Orientation decides which physical end is the venue start (§42 resolved per
  // unit in qualification step 11); "forward" always means index 0 to N-1.
  const directions: ("forward" | "reverse")[] =
    fixture.orientation === "reverse" ? ["reverse", "forward"] : ["forward", "reverse"];
  const zoneOrder: number[] = [];
  let frameCount = 0;
  for (const direction of directions) {
    const frames = chaseFrames(zones, direction);
    for (let step = 0; step < frames.length; step++) {
      const frame = frames[step];
      if (frame === undefined) continue;
      await link.sendRaw(paint(frame));
      await wait(options.stepMs);
      zoneOrder.push(direction === "forward" ? step : zones - 1 - step);
      frameCount += 1;
    }
  }

  return {
    action: "chase",
    hardwareId: fixture.hardwareId,
    mode: "stream",
    stepMs: options.stepMs,
    directions,
    zoneOrder,
    frameCount,
    framesSentHex: link.framesSentHex(),
    commandsSent: [...link.commands],
    atMs,
  };
}

// ---------------------------------------------------------------------------
// RECALIBRATE
// ---------------------------------------------------------------------------

/** Anything that can open the qualification wizard at a step (structural, so
 *  this module never imports the wizard and no cycle exists). */
export interface RecalibrationTarget {
  hardwareId: string;
  enterAt(step: number): { step: number; stepId: string };
}

export interface RecalibrationResult {
  ok: true;
  action: "recalibrate";
  hardwareId: string;
  step: number;
  stepId: string;
  atMs: number;
}

/**
 * Opens the qualification wizard at the chosen step (T-GOV-11). The wizard
 * keeps the state; this only records the intent so the device screen can show
 * which step the user landed on.
 */
export function recalibrate(target: RecalibrationTarget, step: number): RecalibrationResult {
  const opened = target.enterAt(step);
  return {
    ok: true,
    action: "recalibrate",
    hardwareId: target.hardwareId,
    step: opened.step,
    stepId: opened.stepId,
    atMs: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Identify walk
// ---------------------------------------------------------------------------

export interface IdentifyWalkResult {
  action: "identify-walk";
  order: string[];
  results: IdentifyResult[];
}

/**
 * Lights each unit in turn so the user can name and place it. The order is the
 * order the caller passes (venue order); after each unit the caller may pause
 * for the user to answer, and an unverified single-zone unit still flashes
 * because `colorwc` is its verified mode.
 */
export async function identifyWalk(
  exchange: LanExchange,
  fixtures: readonly ActionFixture[],
  options: IdentifyOptions & { pause?: (index: number, hardwareId: string) => Promise<void> },
): Promise<IdentifyWalkResult> {
  const results: IdentifyResult[] = [];
  for (let index = 0; index < fixtures.length; index++) {
    const fixture = fixtures[index];
    if (fixture === undefined) continue;
    results.push(await identify(exchange, fixture, options));
    if (options.pause !== undefined) await options.pause(index, fixture.hardwareId);
  }
  return {
    action: "identify-walk",
    order: results.map((result) => result.hardwareId),
    results,
  };
}

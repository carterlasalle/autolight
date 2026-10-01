// DS-14 live audio capture host (T-AUD-01). The capture window is created and
// owned outside React: the app's main process creates the hidden window, and
// this module owns the host-side logic the app wires to it:
//
//   audio-window   hidden window, owned by main, survives UI reloads
//   renderer       Live window WebAudio, kept for comparison (dies with a reload)
//   combined       audio-window, with a recorded fallback to renderer when the
//                  hidden window cannot start
//
// It also owns the `audio.capture.deviceId` constraint (applied exactly, never
// ignored), the real permission states (granted, denied, not requested),
// idempotent start and stop (one context, no leaked loops), and a bounded
// latest-wins feature stream for the show host.

import type { LiveFeatures } from "./dsp.js";

export type CaptureHost = "audio-window" | "renderer";
export type CaptureHostMode = CaptureHost | "audio-window-with-renderer-fallback";

/** audio.capture.host default (DS-14). */
export const DEFAULT_CAPTURE_HOST_MODE: CaptureHostMode = "audio-window";

export type CapturePermission = "granted" | "denied" | "not-requested";

export interface CaptureDeviceInfo {
  deviceId: string;
  label: string;
  /** True for a loopback device (captures the DJ output instead of a mic). */
  loopback: boolean;
}

export interface CaptureConstraints {
  readonly audio: true | { readonly deviceId: { readonly exact: string } };
}

/**
 * The constraint handed to getUserMedia. An empty device id means "any input"
 * (`audio: true`); anything else is applied exactly, never dropped.
 */
export function captureConstraints(deviceId: string): CaptureConstraints {
  const id = deviceId.trim();
  return id === "" ? { audio: true } : { audio: { deviceId: { exact: id } } };
}

/**
 * DS-14 mode resolution. `audio-window` is the default; the combined mode
 * falls back to the renderer only when the hidden window is unavailable, and
 * the caller records the fallback reason.
 */
export function resolveCaptureHost(
  mode: CaptureHostMode,
  audioWindowAvailable: boolean,
): { host: CaptureHost; fellBack: boolean } {
  if (mode === "renderer") return { host: "renderer", fellBack: false };
  if (mode === "audio-window") return { host: "audio-window", fellBack: false };
  return audioWindowAvailable ? { host: "audio-window", fellBack: false } : { host: "renderer", fellBack: true };
}

/** Setup recommends capturing the DJ output through a loopback device. */
export function recommendLoopbackDevice(devices: readonly CaptureDeviceInfo[]): CaptureDeviceInfo | null {
  return devices.find((device) => device.loopback) ?? null;
}

export interface CaptureSessionHandle {
  readonly id: string;
  stop(): void;
}

/** The platform seam: main's window/session manager implements this. */
export interface CapturePlatform {
  requestPermission(): Promise<CapturePermission>;
  devices(): Promise<readonly CaptureDeviceInfo[]>;
  start(constraints: CaptureConstraints): Promise<CaptureSessionHandle>;
}

export interface CaptureStatus {
  host: CaptureHost;
  fellBack: boolean;
  running: boolean;
  permission: CapturePermission;
  deviceId: string;
  sessionId: string | null;
  /** Feature frames received and superseded on the bounded stream. */
  received: number;
  superseded: number;
  reason: string | null;
}

export class AudioCaptureHost {
  private readonly platform: CapturePlatform;
  private readonly mode: CaptureHostMode;
  private readonly audioWindowAvailable: boolean;
  private deviceIdValue: string;
  private permissionState: CapturePermission = "not-requested";
  private session: CaptureSessionHandle | null = null;
  private pending: LiveFeatures | null = null;
  private received = 0;
  private superseded = 0;
  private lastReason: string | null = null;

  constructor(
    platform: CapturePlatform,
    opts: { mode?: CaptureHostMode; deviceId?: string; audioWindowAvailable?: boolean } = {},
  ) {
    this.platform = platform;
    this.mode = opts.mode ?? DEFAULT_CAPTURE_HOST_MODE;
    this.deviceIdValue = opts.deviceId ?? "";
    this.audioWindowAvailable = opts.audioWindowAvailable ?? true;
  }

  get status(): CaptureStatus {
    const resolution = resolveCaptureHost(this.mode, this.audioWindowAvailable);
    return {
      host: resolution.host,
      fellBack: resolution.fellBack,
      running: this.session !== null,
      permission: this.permissionState,
      deviceId: this.deviceIdValue,
      sessionId: this.session?.id ?? null,
      received: this.received,
      superseded: this.superseded,
      reason: this.lastReason,
    };
  }

  /** Idempotent: a second start reuses the running context, one context only. */
  async start(): Promise<{ ok: boolean; reason: string | null }> {
    if (this.session !== null) return { ok: true, reason: null };
    const permission = this.permissionState === "granted" ? "granted" : await this.platform.requestPermission();
    this.permissionState = permission;
    if (permission !== "granted") {
      this.lastReason = `permission ${permission}`;
      return { ok: false, reason: this.lastReason };
    }
    try {
      this.session = await this.platform.start(captureConstraints(this.deviceIdValue));
      this.lastReason = null;
      return { ok: true, reason: null };
    } catch (error) {
      this.lastReason = error instanceof Error ? error.message : "capture start failed";
      return { ok: false, reason: this.lastReason };
    }
  }

  /** Idempotent: stopping a stopped host is a no-op, never a second stop. */
  stop(): void {
    const session = this.session;
    if (session === null) return;
    this.session = null;
    session.stop();
  }

  /** A device switch restarts with the new exact constraint; one context stays live. */
  async setDevice(deviceId: string): Promise<{ ok: boolean; reason: string | null }> {
    const previous = this.deviceIdValue;
    this.deviceIdValue = deviceId;
    if (this.session === null) return { ok: true, reason: null };
    this.stop();
    const result = await this.start();
    if (!result.ok) this.deviceIdValue = previous;
    return result;
  }

  /**
   * The audio window is owned by main, so a UI reload leaves it running. The
   * renderer host is the comparison point and does not survive the reload.
   */
  onUiReload(): void {
    if (resolveCaptureHost(this.mode, this.audioWindowAvailable).host === "audio-window") return;
    this.stop();
    this.lastReason = "ui-reload: renderer capture does not survive a UI reload (DS-14)";
  }

  /** Bounded, latest wins: a new frame supersedes an unread one. */
  publish(frame: LiveFeatures): void {
    this.received += 1;
    if (this.pending !== null) this.superseded += 1;
    this.pending = frame;
  }

  latest(): LiveFeatures | null {
    const frame = this.pending;
    this.pending = null;
    return frame;
  }
}

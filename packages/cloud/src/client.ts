// Cloud metadata client (T-CLD-01, closes F-CLD-01, F-GOV-17).
//
// Govee OpenAPI facts follow the vendor docs via govee-toolkit
// docs/protocol/cloud.md: 10 requests per minute per device and 10000 per
// day per account, both configuration (govee.cloud.perDevicePerMinute,
// govee.cloud.perAccountPerDay). The client carries metadata only: device
// list, declared capabilities with segment counts and instances, names and
// scene catalogues. It never carries frames (spec 148); any call scheduled
// from the show clock is rejected by ensureNotShowTick, mirroring the
// T-TRU-12 no-cloud-frames invariant.
//
// The API key arrives from safeStorage through the caller (T-SEC-01 owns the
// storage) and is never logged, never interpolated into an error, and never
// written to a recording. Tests inject fetchFn with sanitised recorded
// responses, so this package makes no live call in CI.

export const CLOUD_BASE = "https://openapi.api.govee.com";
export const DEVICES_PATH = "/router/api/v1/user/devices";
export const SCENES_PATH = "/router/api/v1/device/scenes";
export const API_KEY_HEADER = "Govee-API-Key";

/** Cloud never carries frames. Renderers and the show tick read this. */
export const CLOUD_CARRIES_FRAMES = false;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export interface CloudFetchRequest {
  url: string;
  method: "GET" | "POST" | "PUT";
  headers: Record<string, string>;
  body?: string;
}

export interface CloudFetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Injected transport. Electron main supplies fetch; tests supply records. */
export type CloudFetch = (req: CloudFetchRequest) => Promise<CloudFetchResponse>;

/** Raw device entry as the OpenAPI device list returns it. */
export interface RawDeviceEntry {
  device: string;
  model: string;
  deviceName: string;
  controllable: boolean;
  retrievable: boolean;
  supportCmds: string[];
  properties?: Record<string, unknown>;
}

/** Declared capability parsed from one entry. Null means the cloud claims
 *  no segment count and the measured value stands (T-CLD-02). */
export interface DeclaredCapabilities {
  declaredSegmentCount: number | null;
  instances: string[];
  controllable: boolean;
  retrievable: boolean;
}

export interface CloudDevice {
  deviceId: string;
  model: string;
  name: string;
  capabilities: DeclaredCapabilities;
}

export interface CloudScene {
  sceneId: string;
  name: string;
}

export interface CloudClientOptions {
  apiKey: string;
  fetchFn: CloudFetch;
  enabled?: boolean;
  cloudAllowed?: boolean;
  perDevicePerMinute?: number;
  perAccountPerDay?: number;
  now?: () => number;
}

export interface CloudRequestOptions {
  fromShowTick?: boolean;
  deviceKey?: string;
}

export interface CloudAccounting {
  perDevicePerMinute: number;
  perAccountPerDay: number;
  deviceMinuteUsed: number;
  accountDayUsed: number;
  lastServerMinuteRemaining: number | null;
  lastServerDayRemaining: number | null;
  lastRetryAfterMs: number | null;
}

export class CloudDisabledError extends Error {
  readonly code = "cloud-disabled";
}

export class CloudFrameRejectedError extends Error {
  readonly code = "cloud-frame-rejected";
}

export class CloudRateLimitError extends Error {
  readonly code = "cloud-rate-limited";
  readonly scope: "device-minute" | "account-day" | "server";
  readonly retryAfterMs: number;
  constructor(scope: "device-minute" | "account-day" | "server", retryAfterMs: number, detail: string) {
    super(`Cloud rate limit hit (${scope}). Retry in ${Math.ceil(retryAfterMs / 1000)}s. ${detail}`);
    this.scope = scope;
    this.retryAfterMs = retryAfterMs;
  }
}

export class CloudApiError extends Error {
  readonly code = "cloud-api-error";
  readonly status: number;
  constructor(status: number, message: string) {
    super(`Cloud request failed with status ${status}: ${message}`);
    this.status = status;
  }
}

/** Rejects any metadata call scheduled from the show clock. Cloud never
 *  carries frames and never serves beat-critical use (spec 148). */
export function ensureNotShowTick(fromShowTick: boolean | undefined): void {
  if (fromShowTick === true) {
    throw new CloudFrameRejectedError(
      "Cloud call from the show tick is rejected: cloud never carries frames (spec 148).",
    );
  }
}

/** Parses one raw entry. Never assumes a segment count the entry lacks. */
export function parseDeviceEntry(raw: RawDeviceEntry): CloudDevice {
  const props = raw.properties ?? {};
  let declared: number | null = null;
  for (const key of ["segments", "segmentCount", "zoneCount"]) {
    const value = props[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      declared = Math.floor(value);
      break;
    }
  }
  return {
    deviceId: raw.device,
    model: raw.model,
    name: raw.deviceName,
    capabilities: {
      declaredSegmentCount: declared,
      instances: [...raw.supportCmds],
      controllable: raw.controllable,
      retrievable: raw.retrievable,
    },
  };
}

interface RateHeaders {
  minuteRemaining: number | null;
  dayRemaining: number | null;
  retryAfterMs: number | null;
}

function lowerKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = value;
  return out;
}

function asCount(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Rate accounting comes from the response headers, never from a guess. */
export function parseRateHeaders(headers: Record<string, string>): RateHeaders {
  const h = lowerKeys(headers);
  const minuteRemaining =
    asCount(h["x-ratelimit-remaining-minute"]) ?? asCount(h["x-ratelimit-remaining"]);
  const dayRemaining = asCount(h["x-ratelimit-remaining-day"]);
  const retrySeconds = asCount(h["retry-after"]);
  return {
    minuteRemaining,
    dayRemaining,
    retryAfterMs: retrySeconds === null ? null : retrySeconds * 1000,
  };
}

export class CloudMetadataClient {
  private readonly apiKey: string;
  private readonly fetchFn: CloudFetch;
  private readonly enabled: boolean;
  private readonly cloudAllowed: boolean;
  private readonly perDevicePerMinute: number;
  private readonly perAccountPerDay: number;
  private readonly now: () => number;
  private readonly deviceHits = new Map<string, number[]>();
  private readonly accountHits: number[] = [];
  private lastServerMinuteRemaining: number | null = null;
  private lastServerDayRemaining: number | null = null;
  private lastRetryAfterMs: number | null = null;

  constructor(opts: CloudClientOptions) {
    this.apiKey = opts.apiKey;
    this.fetchFn = opts.fetchFn;
    this.enabled = opts.enabled ?? false;
    this.cloudAllowed = opts.cloudAllowed ?? false;
    this.perDevicePerMinute = opts.perDevicePerMinute ?? 10;
    this.perAccountPerDay = opts.perAccountPerDay ?? 10000;
    this.now = opts.now ?? Date.now;
  }

  get accounting(): CloudAccounting {
    const at = this.now();
    let deviceMinuteUsed = 0;
    for (const hits of this.deviceHits.values()) deviceMinuteUsed += this.prune(hits, at, MINUTE_MS).length;
    return {
      perDevicePerMinute: this.perDevicePerMinute,
      perAccountPerDay: this.perAccountPerDay,
      deviceMinuteUsed,
      accountDayUsed: this.prune(this.accountHits, at, DAY_MS).length,
      lastServerMinuteRemaining: this.lastServerMinuteRemaining,
      lastServerDayRemaining: this.lastServerDayRemaining,
      lastRetryAfterMs: this.lastRetryAfterMs,
    };
  }

  /** Device list with names and declared capabilities (recorded in tests). */
  async listDevices(opts: CloudRequestOptions = {}): Promise<CloudDevice[]> {
    this.guard(opts, "account");
    const res = await this.fetchFn({
      url: `${CLOUD_BASE}${DEVICES_PATH}`,
      method: "GET",
      headers: { [API_KEY_HEADER]: this.apiKey, "Content-Type": "application/json" },
    });
    this.noteHeaders(res.headers);
    if (res.status === 429) throw this.limited("server", res.headers);
    if (res.status < 200 || res.status >= 300) throw this.apiError(res);
    const parsed = JSON.parse(res.body) as { data?: RawDeviceEntry[] };
    return (parsed.data ?? []).map(parseDeviceEntry);
  }

  /** Scene catalogue for one device and model (recorded in tests). */
  async listScenes(deviceId: string, model: string, opts: CloudRequestOptions = {}): Promise<CloudScene[]> {
    this.guard(opts, deviceId);
    const query = `device=${encodeURIComponent(deviceId)}&model=${encodeURIComponent(model)}`;
    const res = await this.fetchFn({
      url: `${CLOUD_BASE}${SCENES_PATH}?${query}`,
      method: "GET",
      headers: { [API_KEY_HEADER]: this.apiKey, "Content-Type": "application/json" },
    });
    this.noteHeaders(res.headers);
    if (res.status === 429) throw this.limited("server", res.headers);
    if (res.status < 200 || res.status >= 300) throw this.apiError(res);
    const parsed = JSON.parse(res.body) as { data?: Array<{ id?: string; name?: string; sceneId?: string }> };
    return (parsed.data ?? []).map((entry, index) => ({
      sceneId: entry.sceneId ?? entry.id ?? `scene-${index}`,
      name: entry.name ?? `scene-${index}`,
    }));
  }

  private guard(opts: CloudRequestOptions, deviceKey: string): void {
    ensureNotShowTick(opts.fromShowTick);
    if (!this.enabled || !this.cloudAllowed) {
      throw new CloudDisabledError(
        "Cloud metadata is disabled (govee.cloud.enabled and security.cloudAllowed).",
      );
    }
    const at = this.now();
    const key = opts.deviceKey ?? deviceKey;
    const hits = this.prune(this.hitsFor(key), at, MINUTE_MS);
    if (hits.length >= this.perDevicePerMinute) {
      throw new CloudRateLimitError(
        "device-minute",
        MINUTE_MS,
        `Device minute budget ${this.perDevicePerMinute} per govee.cloud.perDevicePerMinute.`,
      );
    }
    const day = this.prune(this.accountHits, at, DAY_MS);
    if (day.length >= this.perAccountPerDay) {
      throw new CloudRateLimitError(
        "account-day",
        DAY_MS,
        `Account day budget ${this.perAccountPerDay} per govee.cloud.perAccountPerDay.`,
      );
    }
    hits.push(at);
    day.push(at);
  }

  private hitsFor(key: string): number[] {
    const existing = this.deviceHits.get(key);
    if (existing) return existing;
    const fresh: number[] = [];
    this.deviceHits.set(key, fresh);
    return fresh;
  }

  private prune(hits: number[], at: number, windowMs: number): number[] {
    const kept = hits.filter((t) => t > at - windowMs && t <= at);
    hits.length = 0;
    hits.push(...kept);
    return hits;
  }

  private noteHeaders(headers: Record<string, string>): void {
    const parsed = parseRateHeaders(headers);
    if (parsed.minuteRemaining !== null) this.lastServerMinuteRemaining = parsed.minuteRemaining;
    if (parsed.dayRemaining !== null) this.lastServerDayRemaining = parsed.dayRemaining;
    if (parsed.retryAfterMs !== null) this.lastRetryAfterMs = parsed.retryAfterMs;
  }

  private limited(scope: "server", headers: Record<string, string>): CloudRateLimitError {
    const parsed = parseRateHeaders(headers);
    const retryAfterMs = parsed.retryAfterMs ?? MINUTE_MS;
    this.lastRetryAfterMs = retryAfterMs;
    return new CloudRateLimitError(scope, retryAfterMs, "Server refused with status 429.");
  }

  private apiError(res: CloudFetchResponse): CloudApiError {
    let message = "unknown error";
    try {
      const parsed = JSON.parse(res.body) as { message?: unknown };
      if (typeof parsed.message === "string" && parsed.message.length > 0) message = parsed.message;
    } catch {
      if (res.body.length > 0) message = res.body.slice(0, 120);
    }
    return new CloudApiError(res.status, message);
  }
}

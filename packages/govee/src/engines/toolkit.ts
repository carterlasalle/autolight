// T-GOV-01: the govee-toolkit napi binding behind the LanStreamEngine seam
// (DS-02). Provenance: govee-toolkit MIT (Damien Thery, v0.5.0, commit
// ceef296f6382881c5f07698d78fb5719ebca6686). The binding is a native addon
// (napi-rs, context-aware): it can fail to load in a workspace, in a packaged
// app, or in a worker thread. That failure is always a typed unavailable
// reason carried to report().reason, never a silent fallback (§44).
//
// Engine surface used here (packages/node/binding.d.cts upstream):
//   Govee.start() -> Govee; Govee.scan()/devices()/device(id) -> Device/DeviceHandle;
//   DeviceHandle.openStream(resolution, rate, gradient) -> SegmentStream;
//   SegmentStream.setAll(Uint8Array) | zones | rateHz | framesSent |
//   framesSuperseded | close(); DeviceHandle.identify() | segment() | status().
//
// The binding owns its own transport. Our LanStreamEngine contract (T-GOV-03
// parity) lets the caller pace, so setAll hands the newest frame to the
// binding's own newest-wins writer; framesSuperseded() stays the binding's
// counter and framesRequested counts what this wrapper accepted.

import type {
  EngineHealth, EngineMetrics, EngineReport, LanStreamEngine, SegmentStreamLike, StreamOptions,
} from "../razer.js";

export type UnavailableReasonClass = "load" | "context" | "platform";

// Typed unavailable reason: every addon failure becomes this class, so callers
// branch on instanceof and never on a message string.
export class ToolkitUnavailableError extends Error {
  readonly reasonClass: UnavailableReasonClass;
  constructor(reasonClass: UnavailableReasonClass, detail: string) {
    super(detail);
    this.name = "ToolkitUnavailableError";
    this.reasonClass = reasonClass;
  }
}

export function isUnavailableError(err: unknown): err is ToolkitUnavailableError {
  return err instanceof ToolkitUnavailableError;
}

export function unavailable(reasonClass: UnavailableReasonClass, detail: string): ToolkitUnavailableError {
  return new ToolkitUnavailableError(reasonClass, detail);
}

export interface BindingStream {
  readonly zones: number;
  readonly rateHz: number;
  readonly framesSent: number;
  readonly framesSuperseded: number;
  readonly error: string | null;
  setAll(colors: Uint8Array | Array<[number, number, number]>): void;
  close(): Promise<unknown>;
}

export interface BindingHealth {
  state: string;
  failures: number;
  available: boolean;
}

export interface BindingDeviceHandle {
  readonly id: string;
  readonly modes: string[];
  health(mode: string): BindingHealth | null;
  openStream(resolution?: number | "app" | "native" | "groups", rate?: number | "measured", gradient?: boolean | null): Promise<BindingStream>;
  identify(color?: [number, number, number] | Uint8Array, fullBrightness?: boolean | null): Promise<unknown>;
  segment(colors: [number, number, number] | Array<[number, number, number]> | Uint8Array, zones?: number[] | null, resolution?: number | "app" | "native" | "groups", gradient?: boolean | null): Promise<unknown>;
  status(): Promise<BindingDeviceStatus>;
}

export interface BindingDeviceStatus {
  readonly id: string;
  readonly on: boolean | null;
  readonly brightness: number | null;
  readonly raw: unknown;
}

export interface BindingDevice {
  readonly id: string;
  readonly sku: string;
  readonly modes: string[];
}

export interface BindingSdk {
  scan(): Promise<BindingDevice[]>;
  devices(): BindingDevice[];
  device(target: string): BindingDeviceHandle;
  close(): Promise<unknown>;
}

export interface BindingModule {
  readonly __napiBindingTarget?: string;
  readonly VERSION?: string;
  readonly CORE_VERSION?: string;
  start(): Promise<BindingSdk>;
}

export type ToolkitLoader = () => Promise<BindingModule>;

// The conventional external (T-GOV-01): the addon's own loader resolves
// `govee-toolkit` and its platform artifact. On failure the whole load is a
// typed reason; nothing is retried and nothing is faked. A local-only build
// can point AUTOLIGHT_GOVEE_TOOLKIT_ENTRY at a local module for load plumbing.
export const defaultToolkitLoader: ToolkitLoader = async () => {
  const entry = process.env["AUTOLIGHT_GOVEE_TOOLKIT_ENTRY"];
  const specifier = entry !== undefined && entry.length > 0 ? entry : "govee-toolkit";
  const dynamicImport = new Function("s", "return import(s)") as (s: string) => Promise<unknown>;
  const mod = await dynamicImport(specifier);
  const shaped = asBindingModule(mod);
  if (shaped === null) {
    throw unavailable("load", `module "${specifier}" does not expose Govee.start()`);
  }
  return shaped;
};

// napi-rs loaders hand back either the generated commonjs module (Govee class
// plus VERSION/CORE_VERSION statics) or that module under `default` in ESM.
function asBindingModule(value: unknown): BindingModule | null {
  if (typeof value !== "object" || value === null) return null;
  const direct = resolveStart(value);
  if (direct !== null) return direct;
  if ("default" in value) {
    const wrapped = resolveStart(value.default);
    if (wrapped !== null) return wrapped;
  }
  return null;
}

function resolveStart(candidate: unknown): BindingModule | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const version = "VERSION" in candidate && typeof candidate.VERSION === "string" ? candidate.VERSION : undefined;
  const core = "CORE_VERSION" in candidate && typeof candidate.CORE_VERSION === "string" ? candidate.CORE_VERSION : undefined;
  const target = "__napiBindingTarget" in candidate && typeof candidate.__napiBindingTarget === "string"
    ? candidate.__napiBindingTarget
    : undefined;
  const startFn = "start" in candidate ? candidate.start : undefined;
  if (typeof startFn === "function") {
    // Checked as a function; the generated loader's call signature is known.
    const call = startFn as () => Promise<BindingSdk>;
    return withStatics({ start: () => call() }, version, core, target);
  }
  const govee = "Govee" in candidate ? candidate.Govee : undefined;
  if (typeof govee === "function") {
    const staticStart = "start" in govee ? govee.start : undefined;
    if (typeof staticStart === "function") {
      const call = staticStart as () => Promise<BindingSdk>;
      return withStatics({ start: () => call.call(govee) }, version, core, target);
    }
  }
  return null;
}

function withStatics(base: BindingModule, version: string | undefined, core: string | undefined, target: string | undefined): BindingModule {
  return {
    start: base.start,
    ...(version !== undefined ? { VERSION: version } : {}),
    ...(core !== undefined ? { CORE_VERSION: core } : {}),
    ...(target !== undefined ? { __napiBindingTarget: target } : {}),
  };
}

// The toolkit resolution kinds handed to the binding: a qualified count, or
// the toolkit's own `"app"` resolution when qualification has none (§53).
export function resolutionFor(opts: StreamOptions): number | "app" {
  return opts.resolution === null ? "app" : opts.resolution;
}

class ToolkitStream implements SegmentStreamLike {
  readonly zones: number;
  readonly rateHz: number;
  framesRequested = 0;
  private readonly stream: BindingStream;
  private closed = false;

  constructor(stream: BindingStream, fallbackZones: number, fallbackRateHz: number) {
    this.stream = stream;
    this.zones = stream.zones > 0 ? stream.zones : fallbackZones;
    this.rateHz = stream.rateHz > 0 ? stream.rateHz : fallbackRateHz;
  }

  setAll(frame: Uint8Array): void {
    if (this.closed) return;
    this.framesRequested += 1;
    // Newest wins inside the binding: the next writer replaces the previous.
    this.stream.setAll(frame);
  }

  get bindingStream(): BindingStream {
    return this.stream;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // Disarm and wait for the last frame to leave (toolkit SegmentStream).
    void Promise.resolve(this.stream.close()).catch(() => undefined);
  }
}

export interface ToolkitEngineOptions {
  loader: ToolkitLoader;
  rateHz?: number;
  zones?: number;
}

// Result of an up-front load attempt; the failure never throws past DS-02 auto.
export type ToolkitLoadResult =
  | { ok: true }
  | { ok: false; reasonClass: UnavailableReasonClass; detail: string };

export class ToolkitEngine implements LanStreamEngine {
  private readonly loader: ToolkitLoader;
  private readonly rateHz: number;
  private readonly zones: number;
  private sdkPromise: Promise<BindingSdk> | null = null;
  private loadMs: number | null = null;
  private openMs: number | null = null;
  private loadFailure: ToolkitUnavailableError | null = null;
  private target = "unknown";
  private readonly handles = new Map<string, BindingDeviceHandle>();
  private readonly streams = new Map<string, ToolkitStream>();

  constructor(opts: ToolkitEngineOptions) {
    this.loader = opts.loader;
    this.rateHz = opts.rateHz ?? 40;
    this.zones = opts.zones ?? 14;
  }

  // Lazy: the first protocol call starts the SDK. A load failure is sticky and
  // stays a typed reason; nothing is retried mid-show (§147).
  private sdk(): Promise<BindingSdk> {
    if (this.sdkPromise === null) {
      const started = Date.now();
      this.sdkPromise = this.loader().then(async (mod) => {
        this.target = typeof mod.__napiBindingTarget === "string" ? mod.__napiBindingTarget : "unknown";
        const sdk = await mod.start();
        this.loadMs = Date.now() - started;
        return sdk;
      }).catch((err: unknown) => {
        const failure = isUnavailableError(err)
          ? err
          : unavailable("load", err instanceof Error ? err.message : String(err));
        this.loadFailure = failure;
        throw failure;
      });
    }
    return this.sdkPromise;
  }

  report(): EngineReport {
    if (this.loadFailure !== null) {
      return { kind: "toolkit", available: false, reason: this.loadFailure.message };
    }
    return { kind: "toolkit", available: this.sdkPromise !== null };
  }

  // Force the load so DS-02 `auto` can pick an engine up front and record
  // which load happened per host mode (T-GOV-01 DoD). The failure stays typed.
  async ensureLoad(): Promise<ToolkitLoadResult> {
    try {
      await this.sdk();
      return { ok: true };
    } catch (err) {
      if (isUnavailableError(err)) {
        return { ok: false, reasonClass: err.reasonClass, detail: err.message };
      }
      return { ok: false, reasonClass: "load", detail: err instanceof Error ? err.message : String(err) };
    }
  }

  get targetKind(): string {
    return this.target;
  }

  get loadedMs(): number | null {
    return this.loadMs;
  }

  get openStreamMs(): number | null {
    return this.openMs;
  }

  private async handleFor(deviceId: string): Promise<BindingDeviceHandle> {
    const existing = this.handles.get(deviceId);
    if (existing) return existing;
    const sdk = await this.sdk();
    const handle = sdk.device(deviceId);
    this.handles.set(deviceId, handle);
    return handle;
  }

  async discover(): Promise<string[]> {
    const sdk = await this.sdk();
    await sdk.scan();
    return sdk.devices().map((d) => d.id);
  }

  async status(deviceId: string): Promise<{ onOff: boolean; brightness: number; armed: boolean } | null> {
    const handle = await this.handleFor(deviceId);
    const status = await handle.status();
    return {
      onOff: status.on === true,
      brightness: typeof status.brightness === "number" ? status.brightness : 0,
      // This binding revision models onOff/brightness/color, not the raw B2
      // armed frame (binding.d.cts upstream); raw keeps whatever it carried.
      armed: false,
    };
  }

  async openStream(deviceId: string, opts: StreamOptions): Promise<SegmentStreamLike> {
    const handle = await this.handleFor(deviceId);
    const health = handle.health("lan");
    if (health !== null && !health.available) {
      throw unavailable("context", `device ${deviceId} lan transport is not available (${health.state})`);
    }
    const started = Date.now();
    const bindingStream = await handle.openStream(resolutionFor(opts), opts.rateHz, opts.gradient !== 0);
    this.openMs = Date.now() - started;
    const stream = new ToolkitStream(bindingStream, opts.resolution ?? this.zones, opts.rateHz);
    this.streams.set(deviceId, stream);
    return stream;
  }

  async identify(deviceId: string): Promise<void> {
    const handle = await this.handleFor(deviceId);
    await handle.identify([255, 255, 255], true);
  }

  // Non-stream paint (§52 step 8, T-GOV-12 identify): one B0-class pass, no
  // stream open, so the channel stays as the caller left it.
  async segment(deviceId: string, frame: Uint8Array): Promise<void> {
    const handle = await this.handleFor(deviceId);
    await handle.segment(frame, null, "app", false);
  }

  async health(deviceId: string): Promise<EngineHealth | null> {
    const handle = await this.handleFor(deviceId);
    const health = handle.health("lan");
    if (health === null) return null;
    return { state: health.state, failures: health.failures, available: health.available };
  }

  metrics(deviceId?: string): EngineMetrics[] {
    const ids = deviceId !== undefined ? [deviceId] : [...this.streams.keys()];
    return ids.map((id) => {
      const stream = this.streams.get(id);
      return {
        engine: "toolkit",
        framesRequested: stream?.framesRequested ?? 0,
        framesSent: stream?.bindingStream.framesSent ?? 0,
        framesSuperseded: stream?.bindingStream.framesSuperseded ?? 0,
        // The binding emits on its own task; a skipped tick is not observable
        // through this surface (its `error` getter covers a stopped emitter).
        missedTicks: 0,
        effectiveHz: stream?.rateHz ?? this.rateHz,
      };
    });
  }

  async close(): Promise<void> {
    for (const stream of this.streams.values()) stream.close();
    this.streams.clear();
    if (this.sdkPromise !== null) {
      try {
        const sdk = await this.sdkPromise;
        await sdk.close();
      } catch {
        // A load or transport failure at shutdown is already a typed reason.
      }
    }
  }
}

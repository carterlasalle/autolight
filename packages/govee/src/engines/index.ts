// T-GOV-03 / DS-02: the engine switch. `govee.lan.engine` takes `toolkit`,
// `native-ts` or `auto`. In `auto` the toolkit is primary; when the addon
// fails to load, or one device's toolkit stream reports an error class, that
// device runs on native-ts and the device tile shows "native engine (reason)".
// A load failure is a typed reason, never a silent fallback (§44).
//
// Mid-show flip cost: a switch closes the old stream (which disarms the
// channel) and opens the new one (arm, then wait the unit's arm settle before
// the first paint), so a device loses at most one arm-settle gap per flip
// (toolkit lan.md, sequence; T-GOV-08 §46).

import {
  reasonText,
  type EngineHealth, type EngineKind, type EngineMetrics, type EngineMode, type EngineReport,
  type EngineStatus, type LanStreamEngine, type SegmentStreamLike, type StreamOptions,
  type UnavailableReason,
} from "../razer.js";
import { NativeStreamEngine, type NativeEngineOptions } from "./native-ts.js";
import {
  ToolkitEngine, defaultToolkitLoader, isUnavailableError,
  type ToolkitLoader,
} from "./toolkit.js";

export interface DeviceEngineDecision {
  engine: EngineKind;
  // Null on the toolkit; the typed reason when this device runs native (DS-02
  // "native engine (reason)" on the device tile).
  reason: string | null;
}

export interface EngineSummary {
  mode: EngineMode;
  engine: EngineKind;
  reason: string | null;
  perDevice: Record<string, DeviceEngineDecision>;
}

export interface EngineSelectorOptions {
  mode: EngineMode;
  // Injected engines for tests and for hosts that build their own.
  toolkit?: LanStreamEngine;
  native?: LanStreamEngine;
  loader?: ToolkitLoader;
  nativeOptions?: NativeEngineOptions;
}

export interface EngineSelectorDeps {
  mode: EngineMode;
  primary: LanStreamEngine;
  primaryKind: EngineKind;
  primaryReason: string | null;
  native: LanStreamEngine;
}

export class EngineSelector {
  private readonly overrides = new Map<string, DeviceEngineDecision>();

  constructor(private readonly deps: EngineSelectorDeps) {}

  get mode(): EngineMode {
    return this.deps.mode;
  }

  currentKind(): EngineKind {
    return this.deps.primaryKind;
  }

  // Which engine serves this device, with the reason when it is the fallback.
  decision(deviceId: string): DeviceEngineDecision {
    const override = this.overrides.get(deviceId);
    if (override) return override;
    return { engine: this.deps.primaryKind, reason: this.deps.primaryReason };
  }

  summary(): EngineSummary {
    return {
      mode: this.deps.mode,
      engine: this.deps.primaryKind,
      reason: this.deps.primaryReason,
      perDevice: Object.fromEntries([...this.overrides.entries()]),
    };
  }

  report(): EngineReport {
    const base = this.deps.primaryKind === "native-ts"
      ? this.deps.native.report()
      : this.deps.primary.report();
    if (this.deps.primaryReason !== null && this.deps.primaryKind === "native-ts") {
      return { kind: "native-ts", available: base.available, reason: this.deps.primaryReason };
    }
    return base;
  }

  private engineFor(deviceId: string): LanStreamEngine {
    return this.overrides.has(deviceId) ? this.deps.native : this.deps.primary;
  }

  async openStream(deviceId: string, opts: StreamOptions): Promise<SegmentStreamLike> {
    const engine = this.engineFor(deviceId);
    if (engine === this.deps.native || this.deps.primaryKind === "native-ts") {
      return engine.openStream(deviceId, opts);
    }
    try {
      return await engine.openStream(deviceId, opts);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const reasonClass: UnavailableReason = isUnavailableError(err) ? "context" : "error-class";
      this.noteFallback(deviceId, reasonText(reasonClass, detail));
      return this.deps.native.openStream(deviceId, opts);
    }
  }

  // Recorded when a toolkit stream fails for a device (or by the caller
  // observing an error class on the same stream later).
  noteFallback(deviceId: string, reason: string): void {
    this.overrides.set(deviceId, { engine: "native-ts", reason });
  }

  async discover(): Promise<string[]> {
    return this.deps.primary.discover();
  }

  async status(deviceId: string): Promise<EngineStatus | null> {
    return this.engineFor(deviceId).status(deviceId);
  }

  async identify(deviceId: string): Promise<void> {
    return this.engineFor(deviceId).identify(deviceId);
  }

  async segment(deviceId: string, frame: Uint8Array): Promise<void> {
    return this.engineFor(deviceId).segment(deviceId, frame);
  }

  async health(deviceId: string): Promise<EngineHealth | null> {
    return this.engineFor(deviceId).health(deviceId);
  }

  metrics(deviceId?: string): EngineMetrics[] {
    const target = deviceId !== undefined ? this.engineFor(deviceId) : this.deps.primary;
    if (deviceId === undefined && this.deps.primary !== this.deps.native) {
      return [...this.deps.primary.metrics(), ...this.deps.native.metrics()];
    }
    return target.metrics(deviceId);
  }

  async close(): Promise<void> {
    if (this.deps.primary !== this.deps.native) {
      await this.deps.primary.close();
      await this.deps.native.close();
      return;
    }
    await this.deps.primary.close();
  }
}

// Builds the selector for a mode. `auto` attempts the toolkit load once, up
// front, so the whole show has one engine decision and one recorded load
// result; `toolkit` throws the typed reason instead of downgrading.
export async function createEngineSelector(opts: EngineSelectorOptions): Promise<EngineSelector> {
  const native = opts.native ?? new NativeStreamEngine(opts.nativeOptions ?? {});
  const toolkit = opts.toolkit ?? new ToolkitEngine({ loader: opts.loader ?? defaultToolkitLoader });

  if (opts.mode === "native-ts") {
    return new EngineSelector({
      mode: opts.mode,
      primary: native,
      primaryKind: "native-ts",
      primaryReason: "forced by govee.lan.engine",
      native,
    });
  }

  const load = await attemptToolkitLoad(toolkit);
  if (load.ok) {
    return new EngineSelector({
      mode: opts.mode,
      primary: toolkit,
      primaryKind: "toolkit",
      primaryReason: null,
      native,
    });
  }
  if (opts.mode === "toolkit") {
    throw new ToolkitLoadFailure(load.reasonClass, load.detail);
  }
  // auto: every device tile carries the same typed reason.
  return new EngineSelector({
    mode: opts.mode,
    primary: native,
    primaryKind: "native-ts",
    primaryReason: reasonText(load.reasonClass, load.detail),
    native,
  });
}

export class ToolkitLoadFailure extends Error {
  readonly reasonClass: UnavailableReason;
  constructor(reasonClass: UnavailableReason, detail: string) {
    super(reasonText(reasonClass, detail));
    this.name = "ToolkitLoadFailure";
    this.reasonClass = reasonClass;
  }
}

async function attemptToolkitLoad(toolkit: LanStreamEngine): Promise<
  { ok: true } | { ok: false; reasonClass: UnavailableReason; detail: string }
> {
  if (toolkit instanceof ToolkitEngine) {
    const result = await toolkit.ensureLoad();
    return result.ok ? { ok: true } : { ok: false, reasonClass: result.reasonClass, detail: result.detail };
  }
  // An injected engine owns its own load; its report is the answer.
  const report = toolkit.report();
  if (report.available) return { ok: true };
  return { ok: false, reasonClass: "load", detail: report.reason ?? "toolkit engine reports unavailable" };
}

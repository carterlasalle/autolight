// BLE backends and placement (T-BLE-01, DS-04; WP04 BLE section).
//
// `govee.ble.backend` takes `toolkit-ble`, `noble` or `auto`. In `auto` the
// toolkit adapter is primary when it loads and scans; when it fails to load,
// fails a scan, or one device's connection reports an error, that device runs
// on noble and the device tile shows the typed reason. A load failure is a
// typed reason, never a silent fallback.
//
// Sources: WP04 which cites govee-toolkit docs/protocol/ble.md, the Node
// binding compiled with features lan, ble, cloud (btleplug underneath), and
// the noble path with our own codec from the ble package. No claim here
// measures the owner's units; sim runs prove code, never hardware.
import type { BleAdvertisement } from "./scan.js";

/** Backend kinds behind the DS-04 switch. */
export type BleBackendKind = "toolkit-ble" | "noble";

/** DS-04 modes. `auto` is toolkit when it loads and scans, else noble. */
export type BleBackendMode = BleBackendKind | "auto";

/** Raw notify bytes from the 0x2b10 characteristic. */
export type BleNotifyHandler = (notify: Uint8Array) => void;

/** One open GATT link. The link manager owns pacing and reconnect. */
export interface BleConnection {
  readonly address: string;
  readonly kind: BleBackendKind;
  subscribe(handler: BleNotifyHandler): void;
  write(frame: Uint8Array): Promise<void>;
  disconnect(): Promise<void>;
}

/** The seam both backends satisfy. Test fakes and the sim implement it. */
export interface BleAdapter {
  readonly kind: BleBackendKind;
  scan(timeoutMs: number): Promise<BleAdvertisement[]>;
  connect(address: string): Promise<BleConnection>;
  close(): Promise<void>;
}

/** Typed unavailable reason: every backend failure becomes this class. */
export type BleUnavailableReason = "load" | "context" | "platform" | "error-class";

export class BleBackendUnavailableError extends Error {
  readonly reasonClass: BleUnavailableReason;
  constructor(reasonClass: BleUnavailableReason, detail: string) {
    super(detail);
    this.name = "BleBackendUnavailableError";
    this.reasonClass = reasonClass;
  }
}

function reasonLabel(reasonClass: BleUnavailableReason): string {
  switch (reasonClass) {
    case "load": return "ble backend failed to load";
    case "context": return "ble backend unavailable in this context";
    case "platform": return "ble backend has no artifact for this platform";
    case "error-class": return "ble backend error";
  }
}

/** Tile text for a device that fell back: kind plus the typed reason. */
export function bleReasonText(reasonClass: BleUnavailableReason, detail: string): string {
  return `${reasonLabel(reasonClass)}: ${detail}`;
}

export interface BleDeviceDecision {
  kind: BleBackendKind;
  reason: string | null;
}

export interface BleBackendSummary {
  mode: BleBackendMode;
  current: BleBackendKind;
  reason: string | null;
}

export interface BackendSelectorOptions {
  mode: BleBackendMode;
  toolkit?: BleAdapter;
  noble?: BleAdapter;
  loadToolkit?: () => Promise<BleAdapter>;
}

interface SelectorDeps {
  mode: BleBackendMode;
  primary: BleAdapter;
  primaryKind: BleBackendKind;
  primaryReason: string | null;
  secondary: BleAdapter | null;
}

/** DS-04 switch. One decision per show plus a per-device override map. */
export class BackendSelector {
  private readonly overrides = new Map<string, BleDeviceDecision>();

  constructor(private readonly deps: SelectorDeps) {}

  get mode(): BleBackendMode {
    return this.deps.mode;
  }

  currentKind(): BleBackendKind {
    return this.deps.primaryKind;
  }

  decision(address: string): BleDeviceDecision {
    return this.overrides.get(address) ?? { kind: this.deps.primaryKind, reason: this.deps.primaryReason };
  }

  summary(): BleBackendSummary {
    return { mode: this.deps.mode, current: this.deps.primaryKind, reason: this.deps.primaryReason };
  }

  report(): { kind: BleBackendKind; available: boolean; reason?: string } {
    const out: { kind: BleBackendKind; available: boolean; reason?: string } = {
      kind: this.deps.primaryKind,
      available: true,
    };
    if (this.deps.primaryReason !== null) out.reason = this.deps.primaryReason;
    return out;
  }

  /** Scan on primary; a throwing scan retries once on the other backend. */
  async scan(timeoutMs: number): Promise<BleAdvertisement[]> {
    try {
      return await this.deps.primary.scan(timeoutMs);
    } catch (err) {
      const secondary = this.deps.secondary;
      if (secondary === null) throw err;
      const detail = err instanceof Error ? err.message : String(err);
      const reasonClass: BleUnavailableReason = err instanceof BleBackendUnavailableError ? err.reasonClass : "error-class";
      this.deps.primaryReason = bleReasonText(reasonClass, detail);
      return secondary.scan(timeoutMs);
    }
  }

  /** Connect on the device's backend; a failing device retries on the other. */
  async connect(address: string): Promise<BleConnection> {
    const override = this.overrides.get(address);
    if (override !== undefined && this.deps.secondary !== null && override.kind !== this.deps.primaryKind) {
      return this.deps.secondary.connect(address);
    }
    try {
      return await this.deps.primary.connect(address);
    } catch (err) {
      const secondary = this.deps.secondary;
      if (secondary === null) throw err;
      const detail = err instanceof Error ? err.message : String(err);
      const reasonClass: BleUnavailableReason = err instanceof BleBackendUnavailableError ? err.reasonClass : "error-class";
      this.noteFallback(address, bleReasonText(reasonClass, detail));
      return secondary.connect(address);
    }
  }

  /** Records that a device now runs on the other backend with the reason. */
  noteFallback(address: string, reason: string): void {
    const other = this.deps.secondary;
    if (other === null) return;
    this.overrides.set(address, { kind: other.kind, reason });
  }

  async close(): Promise<void> {
    await this.deps.primary.close();
    const secondary = this.deps.secondary;
    if (secondary !== null && secondary !== this.deps.primary) await secondary.close();
  }
}

export class BleBackendLoadFailure extends Error {
  readonly reasonClass: BleUnavailableReason;
  constructor(reasonClass: BleUnavailableReason, detail: string) {
    super(bleReasonText(reasonClass, detail));
    this.name = "BleBackendLoadFailure";
    this.reasonClass = reasonClass;
  }
}

/** Builds the selector. `auto` attempts the toolkit load once, up front. */
export async function createBackendSelector(opts: BackendSelectorOptions): Promise<BackendSelector> {
  const noble = opts.noble ?? null;
  if (opts.mode === "noble") {
    if (noble === null) throw new BleBackendLoadFailure("load", "no noble adapter was provided");
    return new BackendSelector({ mode: opts.mode, primary: noble, primaryKind: "noble", primaryReason: null, secondary: null });
  }
  if (opts.mode === "toolkit-ble" && opts.toolkit !== undefined) {
    const secondary = noble;
    return new BackendSelector({ mode: opts.mode, primary: opts.toolkit, primaryKind: "toolkit-ble", primaryReason: null, secondary });
  }
  const loaded = await tryLoadToolkit(opts);
  if (opts.mode === "toolkit-ble") {
    if (!loaded.ok) throw new BleBackendLoadFailure(loaded.reasonClass, loaded.detail);
    return new BackendSelector({ mode: opts.mode, primary: loaded.adapter, primaryKind: "toolkit-ble", primaryReason: null, secondary: noble });
  }
  if (loaded.ok) {
    return new BackendSelector({ mode: "auto", primary: loaded.adapter, primaryKind: "toolkit-ble", primaryReason: null, secondary: noble });
  }
  if (noble === null) throw new BleBackendLoadFailure(loaded.reasonClass, loaded.detail);
  return new BackendSelector({
    mode: "auto",
    primary: noble,
    primaryKind: "noble",
    primaryReason: bleReasonText(loaded.reasonClass, loaded.detail),
    secondary: null,
  });
}

async function tryLoadToolkit(opts: BackendSelectorOptions): Promise<
  { ok: true; adapter: BleAdapter } | { ok: false; reasonClass: BleUnavailableReason; detail: string }
> {
  if (opts.toolkit !== undefined) return { ok: true, adapter: opts.toolkit };
  const load = opts.loadToolkit;
  if (load === undefined) return { ok: false, reasonClass: "load", detail: "no toolkit loader was provided" };
  try {
    return { ok: true, adapter: await load() };
  } catch (err) {
    if (err instanceof BleBackendUnavailableError) return { ok: false, reasonClass: err.reasonClass, detail: err.message };
    return { ok: false, reasonClass: "load", detail: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Placement (T-BLE-01: worker thread, utility process, or main)
// ---------------------------------------------------------------------------

/** Where the BLE link manager runs. */
export type BleHost = "worker-thread" | "utility-process" | "main";

/** What the current process proved it can do. Set by a live capability check. */
export interface BlePlacementCaps {
  workerBleOk: boolean;
  utilityBleOk: boolean;
}

export interface BlePlacement {
  host: BleHost;
  /** Why this host, naming the backend and the capability that decided it. */
  reason: string;
  /** True when frames cross a thread boundary on a latest-wins channel. */
  bridged: boolean;
}

/**
 * Picks the link manager host. Worker thread first (lowest added latency),
 * then the utility process, then main with a latest-wins bridge when the OS
 * stack only works there (seen on macOS CoreBluetooth).
 */
export function placeBleBackend(kind: BleBackendKind, caps: BlePlacementCaps): BlePlacement {
  if (caps.workerBleOk) {
    return { host: "worker-thread", reason: `${kind} scans in the show host worker thread`, bridged: false };
  }
  if (caps.utilityBleOk) {
    return { host: "utility-process", reason: `${kind} needs the Electron utility process`, bridged: false };
  }
  return {
    host: "main",
    reason: `${kind} requires the main thread; show host frames cross a latest-wins channel`,
    bridged: true,
  };
}

/**
 * Latest-wins bridge for the main-thread placement: the show host posts
 * frames, the link manager takes only the newest. A burst of posts never
 * queues; superseded frames count as drops.
 */
export class LatestWinsChannel {
  private pending: Uint8Array | null = null;
  private drops = 0;

  send(frame: Uint8Array): void {
    if (this.pending !== null) this.drops += 1;
    this.pending = frame.slice();
  }

  take(): Uint8Array | null {
    const frame = this.pending;
    this.pending = null;
    return frame;
  }

  get depth(): number {
    return this.pending === null ? 0 : 1;
  }

  get dropped(): number {
    return this.drops;
  }
}

// Service contract for the main process (T-ARC-05, 04-target-architecture
// section 1). Every service exposes start(), stop() and status(). The state
// vocabulary is the startup state machine one (spec 132): a service that
// cannot do its job degrades with a reason instead of pretending to run.
export type ServiceState =
  | "idle"
  | "starting"
  | "running"
  | "degraded"
  | "failed"
  | "stopped";

export interface ServiceStatus {
  name: string;
  state: ServiceState;
  // Honest reason for degraded/failed: what is missing, not a stack trace.
  detail?: string;
  startedAtMs?: number;
  stoppedAtMs?: number;
  counters: Record<string, number>;
}

export interface Service {
  readonly name: string;
  start(): ServiceStatus | Promise<ServiceStatus>;
  stop(): ServiceStatus | Promise<ServiceStatus>;
  status(): ServiceStatus;
}

// Shared bookkeeping so the eleven services do not each re-implement the same
// six fields. Not a framework: set, count, status.
export class ServiceTracker {
  private state: ServiceState = "idle";
  private detail: string | undefined;
  private startedAtMs: number | undefined;
  private stoppedAtMs: number | undefined;
  private counters: Record<string, number> = {};

  constructor(private readonly serviceName: string) {}

  set(state: ServiceState, detail?: string): void {
    const previous = this.state;
    this.state = state;
    this.detail = detail;

    if (state === "running" || state === "degraded") {
      // Refresh on (re)start from a non-running state; ??= would keep the
      // first-ever start time across stop/start cycles and report stale.
      if (previous !== "running" && previous !== "degraded") {
        this.startedAtMs = Date.now();
      }

      this.stoppedAtMs = undefined;
    }

    if (state === "stopped" || state === "failed") {
      this.stoppedAtMs = Date.now();
    }
  }

  get current(): ServiceState {
    return this.state;
  }

  count(key: string, by = 1): void {
    this.counters[key] = (this.counters[key] ?? 0) + by;
  }

  setCounter(key: string, value: number): void {
    this.counters[key] = value;
  }

  status(): ServiceStatus {
    const out: ServiceStatus = {
      name: this.serviceName,
      state: this.state,
      counters: { ...this.counters },
    };

    if (this.detail !== undefined) out.detail = this.detail;

    if (this.startedAtMs !== undefined) out.startedAtMs = this.startedAtMs;

    if (this.stoppedAtMs !== undefined) out.stoppedAtMs = this.stoppedAtMs;

    return out;
  }
}

// Error text normalization used by every service's typed error paths; the
// alternative is the same three-line instanceof dance copied eleven times.
export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;

  if (err !== null && typeof err === "object" && "message" in err && typeof err.message === "string") {
    return err.message;
  }

  return String(err);
}

// Electron owns userData. The import stays dynamic because `electron` has no
// app object in plain Node (vitest imports these services directly), so a
// static import would fail at module load in the test runner.
export async function resolveUserDataDir(explicit?: string): Promise<string | undefined> {
  if (explicit !== undefined && explicit.length > 0) return explicit;

  let app: { getPath(name: string): string } | undefined;

  try {
    const mod: { app?: { getPath(name: string): string } } = await import("electron");
    app = mod.app;
  } catch {
    // Electron unavailable (plain Node/vitest): no userData dir.
    return undefined;
  }

  if (app === undefined) return undefined;
  // A genuine getPath failure throws to the caller: it must not be
  // mistaken for "electron not installed".
  const dir = app.getPath("userData");

  return dir.length > 0 ? dir : undefined;
}

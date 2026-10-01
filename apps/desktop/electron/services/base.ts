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
    this.state = state;
    this.detail = detail;
    if (state === "running" || state === "degraded") {
      this.startedAtMs ??= Date.now();
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

export interface ServiceError {
  ok: false;
  error: { code: string; message: string };
}

// Error text normalization used by every service's typed error paths; the
// alternative is the same three-line instanceof dance copied eleven times.
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Electron owns userData. The import is dynamic because `electron` has no app
// object in plain Node (vitest imports these services directly), so a static
// import would fail at module load in the test runner.
export async function resolveUserDataDir(explicit?: string): Promise<string | undefined> {
  if (explicit !== undefined) return explicit;
  try {
    const { app } = await import("electron");
    return app.getPath("userData");
  } catch {
    return undefined;
  }
}

import { join } from "node:path";
import { ServiceTracker, messageOf, type Service, type ServiceStatus } from "./base.js";

// T-ARC-03 and 04-target-architecture section 1: lifecycle owns the startup
// and shutdown state machines and the crash policy. Stage names and the stage
// status vocabulary (pending, running, ok, degraded(reason), failed(reason))
// come from spec 132; every stage carries timing for the Setup screen and the
// status bar.

export type StageName =
  | "db"
  | "show-worker"
  | "govee"
  | "dj-adapter"
  | "library"
  | "analysis"
  | "venue"
  | "tracks"
  | "plans"
  | "arm"
  | "ready";

export const STARTUP_ORDER: StageName[] = [
  "db",
  "show-worker",
  "govee",
  "dj-adapter",
  "library",
  "analysis",
  "venue",
  "tracks",
  "plans",
  "arm",
  "ready",
];

export type StageState = "pending" | "running" | "ok" | "degraded" | "failed";

export interface StageRecord {
  stage: StageName;
  state: StageState;
  detail?: string;
  startedAtMs?: number;
  ms?: number;
}

// Shutdown order (spec 133). A step that times out is logged and shutdown
// continues: teardown never blocks on one wedged step.
export const SHUTDOWN_ORDER = [
  "freeze-ui",
  "ending-look",
  "disarm-streams",
  "dj-adapters",
  "analysis",
  "flush-db",
  "workers",
  "exit",
] as const;

export type ShutdownStep = (typeof SHUTDOWN_ORDER)[number];

export type ShutdownPorts = {
  [step in ShutdownStep]?: () => Promise<void> | void;
};

export interface ShutdownStepLog {
  step: ShutdownStep;
  ms: number;
  timedOut: boolean;
  error?: string;
}

export interface ShutdownOptions {
  timeoutMs: number;
  ports: ShutdownPorts;
  onStep?: (step: string, ms: number) => void;
}

export async function runShutdown(opts: ShutdownOptions): Promise<ShutdownStepLog[]> {
  const logs: ShutdownStepLog[] = [];
  for (const step of SHUTDOWN_ORDER) {
    const port = opts.ports[step];
    const started = Date.now();
    let entry: ShutdownStepLog;
    if (!port) {
      // No port wired for this step: record it so the shutdown timeline shows
      // the full spec 133 order, including the steps this build does not own.
      entry = { step, ms: 0, timedOut: false };
    } else {
      const timer = Promise.withResolvers<true>();
      const handle = setTimeout(() => { timer.resolve(true); }, opts.timeoutMs);
      try {
        const result = await Promise.race([Promise.resolve(port()), timer.promise]);
        entry = result === true
          ? { step, ms: Date.now() - started, timedOut: true, error: `step timed out after ${opts.timeoutMs} ms` }
          : { step, ms: Date.now() - started, timedOut: false };
      } catch (err) {
        entry = { step, ms: Date.now() - started, timedOut: false, error: messageOf(err) };
      } finally {
        clearTimeout(handle);
      }
    }
    logs.push(entry);
    opts.onStep?.(step, entry.ms);
  }
  return logs;
}

export interface CrashPolicyPorts {
  // runtime.crash.holdMs from the config registry.
  holdMs: number;
  crashRecordPath: string;
  error: unknown;
  // Safe look: hold the last frame, then dim to zero after holdMs.
  safeLook(kind: "hold" | "dim"): void;
  restartShowHost(): void;
  writeRecord(path: string, json: string): void;
}

export interface CrashPolicyResult {
  recordPath: string;
  heldMs: number;
  restarted: boolean;
  errorText: string;
  // Resolves when the safe look reaches its dim phase.
  dimmed: Promise<void>;
}

export function applyCrashPolicy(ports: CrashPolicyPorts): CrashPolicyResult {
  const at = new Date().toISOString();
  const errorText = messageOf(ports.error);
  ports.writeRecord(ports.crashRecordPath, JSON.stringify({ at, error: errorText }));
  ports.safeLook("hold");
  const dim = Promise.withResolvers<void>();
  const handle = setTimeout(() => {
    ports.safeLook("dim");
    dim.resolve();
  }, ports.holdMs);
  handle.unref?.();
  ports.restartShowHost();
  return {
    recordPath: ports.crashRecordPath,
    heldMs: ports.holdMs,
    restarted: true,
    errorText,
    dimmed: dim.promise,
  };
}

// Crash records and the config file both live under the Electron userData
// directory; this stays pure so the policy is testable without Electron.
export function crashRecordPath(userDataDir: string): string {
  return join(userDataDir, "crash-last.json");
}

export interface LifecycleServiceOptions {
  userDataDir?: string;
}

export class LifecycleService implements Service {
  readonly name = "lifecycle";
  private readonly tracker = new ServiceTracker("lifecycle");
  private stages: StageRecord[] = STARTUP_ORDER.map((stage) => ({ stage, state: "pending" as StageState }));
  private accepting = true;
  private readonly userDataDir: string | undefined;

  constructor(opts: LifecycleServiceOptions = {}) {
    this.userDataDir = opts.userDataDir;
  }

  start(): ServiceStatus {
    this.stages = STARTUP_ORDER.map((stage) => ({ stage, state: "pending" as StageState }));
    this.accepting = true;
    this.tracker.set("running");
    return this.status();
  }

  stop(): ServiceStatus {
    // spec 133 step 1: the UI stops sending intents before anything else.
    this.accepting = false;
    this.tracker.set("stopped");
    return this.status();
  }

  status(): ServiceStatus {
    this.tracker.setCounter("stages", this.stages.length);
    this.tracker.setCounter("ok", this.stages.filter((s) => s.state === "ok").length);
    this.tracker.setCounter("degraded", this.stages.filter((s) => s.state === "degraded").length);
    this.tracker.setCounter("failed", this.stages.filter((s) => s.state === "failed").length);
    this.tracker.setCounter("ready", this.ready() ? 1 : 0);
    this.tracker.setCounter("acceptingUi", this.accepting ? 1 : 0);
    const out = this.tracker.status();
    if (this.degradedReasons().length > 0) out.detail = this.degradedReasons().join("; ");
    return out;
  }

  // A stage marked running records its start; ok/degraded/failed record ms.
  advance(stage: StageName, state: StageState, detail?: string): StageRecord {
    const found = this.stages.find((s) => s.stage === stage);
    if (!found) throw new Error(`unknown startup stage: ${stage}`);
    found.state = state;
    if (detail !== undefined) found.detail = detail;
    if (state === "running") found.startedAtMs = Date.now();
    if (state !== "running" && state !== "pending" && found.startedAtMs !== undefined) {
      found.ms = Date.now() - found.startedAtMs;
    }
    return found;
  }

  nextStage(): StageName | null {
    const next = this.stages.find((s) => s.state !== "ok" && s.state !== "degraded");
    return next?.stage ?? null;
  }

  ready(): boolean {
    return this.stages.every((s) => s.state === "ok" || s.state === "degraded");
  }

  degradedReasons(): string[] {
    return this.stages
      .filter((s) => s.state === "degraded" || s.state === "failed")
      .map((s) => `${s.stage}: ${s.detail ?? s.state}`);
  }

  records(): StageRecord[] {
    return this.stages.map((s) => ({ ...s }));
  }

  setAcceptingUi(accepting: boolean): void {
    this.accepting = accepting;
  }

  isAcceptingUi(): boolean {
    return this.accepting;
  }

  shutdown(opts: { timeoutMs: number; ports: ShutdownPorts; onStep?: (step: string, ms: number) => void }): Promise<ShutdownStepLog[]> {
    this.accepting = false;
    return runShutdown(opts);
  }

  crashPath(): string | null {
    return this.userDataDir === undefined ? null : crashRecordPath(this.userDataDir);
  }
}

let instance: LifecycleService | null = null;

export function getLifecycleService(opts: LifecycleServiceOptions = {}): LifecycleService {
  instance ??= new LifecycleService(opts);
  return instance;
}

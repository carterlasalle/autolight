import { AnalysisClient, type AnalyzeRequest, type AnalyzeResult } from "@autolight/analysis-client";
import { ServiceTracker, messageOf, type Service, type ServiceStatus } from "./base.js";

// analysis-supervisor (04-target-architecture section 1): the only component
// allowed to spawn the Python worker. It owns the worker lifecycle, the
// requeue on crash (spec 109) and the pending/queued counts; the framed
// stdio protocol itself lives in @autolight/analysis-client.

// The slice of AnalysisClient the supervisor drives; tests inject a fake so
// no `uv` process is spawned.
export interface AnalysisWorkerPort {
  start(): void;
  stop(): void;
  analyze(req: AnalyzeRequest): Promise<AnalyzeResult>;
  pendingCount(): number;
  queuedCount(): number;
  /** Liveness for crash classification; absent means unknown (treated as down). */
  running?: () => boolean;
}

export interface AnalysisSupervisorOptions {
  command?: string;
  projectDir?: string;
  createWorker?: () => AnalysisWorkerPort;
}

export interface AnalysisSubmitReply {
  ok: true;
  artifactPath: string;
}

export interface AnalysisSubmitFailure {
  ok: false;
  error: { code: string; message: string };
}

export class AnalysisSupervisor implements Service {
  readonly name = "analysis-supervisor";
  private readonly tracker = new ServiceTracker("analysis-supervisor");
  private worker: AnalysisWorkerPort | null = null;
  private spawned = false;
  private readonly opts: AnalysisSupervisorOptions;

  constructor(opts: AnalysisSupervisorOptions = {}) {
    this.opts = opts;
  }

  start(): ServiceStatus {
    // Lazy spawn: the worker starts with the first job so a missing `uv` or a
    // project path problem cannot block boot (spec 132 degraded stage).
    this.tracker.set("running", "worker spawns on the first analysis job");

    return this.status();
  }

  stop(): ServiceStatus {
    try {
      this.worker?.stop();
    } catch { /* teardown never throws */ }

    // The port is kept: start() is idempotent, submit() is rejected while the
    // tracker reads "stopped", and a later start() resumes the same client
    // instead of leaking a second one.
    this.spawned = false;
    this.tracker.set("stopped");

    return this.status();
  }

  status(): ServiceStatus {
    this.tracker.setCounter("spawned", this.spawned ? 1 : 0);
    this.tracker.setCounter("pending", this.worker?.pendingCount() ?? 0);
    this.tracker.setCounter("queued", this.worker?.queuedCount() ?? 0);

    return this.tracker.status();
  }

  workerPort(): AnalysisWorkerPort {
    if (this.worker === null) {
      this.worker = this.opts.createWorker?.() ?? new AnalysisClient(this.opts.command, this.opts.projectDir);
    }

    return this.worker;
  }

  private ensureWorker(): AnalysisWorkerPort {
    const port = this.workerPort();

    if (!this.spawned) {
      port.start();
      this.spawned = true;
      this.tracker.count("spawns");
    }

    return port;
  }

  async submit(req: AnalyzeRequest): Promise<AnalysisSubmitReply | AnalysisSubmitFailure> {
    if (this.tracker.current !== "running" && this.tracker.current !== "degraded") {
      return { ok: false, error: { code: "E_SUPERVISOR_NOT_STARTED", message: "analysis-supervisor is not started" } };
    }

    this.tracker.count("jobs");

    try {
      const result = await this.ensureWorker().analyze(req);

      return { ok: true, artifactPath: result.artifactPath };
    } catch (err) {
      const message = messageOf(err);
      this.tracker.count("failures");
      // The client owns child supervision (backoff, heartbeat) and its
      // start() is idempotent, so a rejection from a live worker is a job
      // failure, not a crash: only a worker that is actually down counts a
      // restart and defers its respawn to the next submit (spec 109).
      const alive = this.worker?.running?.() ?? false;

      if (alive) {
        this.tracker.set("degraded", `analysis job failed: ${message}`);
      } else {
        this.spawned = false;
        this.tracker.count("restarts");
        this.tracker.set("degraded", `analysis worker down, restarts on the next job: ${message}`);
      }

      return { ok: false, error: { code: "E_ANALYSIS_FAILED", message } };
    }
  }
}

let instance: AnalysisSupervisor | null = null;

export function getAnalysisSupervisor(opts: AnalysisSupervisorOptions = {}): AnalysisSupervisor {
  // Options only take effect on the first call: a second caller passing a
  // different command/projectDir/createWorker would silently drive a
  // mis-configured worker, so fail loudly instead of ignoring them.
  if (instance !== null && Object.values(opts).some((value) => value !== undefined)) {
    throw new Error("analysis-supervisor already created; later options are ignored");
  }

  instance ??= new AnalysisSupervisor(opts);

  return instance;
}

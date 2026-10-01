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
      // A worker that died mid-job is restarted on the next submit (spec 109).
      this.spawned = false;
      this.tracker.count("restarts");
      this.tracker.set("degraded", `analysis job failed: ${message}`);
      return { ok: false, error: { code: "E_ANALYSIS_FAILED", message } };
    }
  }
}

let instance: AnalysisSupervisor | null = null;

export function getAnalysisSupervisor(opts: AnalysisSupervisorOptions = {}): AnalysisSupervisor {
  instance ??= new AnalysisSupervisor(opts);
  return instance;
}

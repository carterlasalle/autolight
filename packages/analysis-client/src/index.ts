import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  PROTOCOL_VERSION,
  classifyError,
  frameId,
  parseFrame,
  toJob,
  type AnalyzeErrorCode,
  type AnalyzeRequest,
  type AnalyzeResult,
  type AnalysisJob,
  type AnalysisJobState,
  type ProtocolFrame,
} from "./protocol.js";
import { computeReadiness } from "./readiness.js";

export type {
  AnalyzeRequest,
  AnalyzeResult,
  AnalyzeFailure,
  AnalyzeErrorCode,
  AnalysisJob,
  AnalysisJobState,
} from "./protocol.js";

// Framed-JSON stdio supervisor for the Python worker (T-ANA-02, spec 14/109).
// Playback never blocks: analyze() queues; crashes requeue with identical
// inputs; large artifacts travel by path. PyTorch never runs in this process.
export interface SupervisorOptions {
  command?: string;
  projectDir?: string;
  /** Restart backoff window (analysis.worker.restartBackoffMs). */
  restartBackoffMs?: [number, number];
  /** Per-job deadline (analysis.worker.jobTimeoutMs). */
  jobTimeoutMs?: number;
  /** Heartbeat deadline: restart when the worker goes quiet. */
  heartbeatTimeoutMs?: number;
  /** In-flight jobs (analysis.worker.concurrency). */
  concurrency?: number;
  progress?: (job: AnalysisJob, stage: string) => void;
  log?: (event: string, detail?: unknown) => void;
}

export interface PendingEntry {
  job: AnalysisJob;
  resolve: (r: AnalyzeResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof clearTimeout> | undefined;
}

export interface SupervisorStatus {
  running: boolean;
  restarts: number;
  pending: number;
  queued: number;
  lastHeartbeat: number | null;
}

function packageRoot(): string {
  return dirname(fileURLToPath(new URL(".", import.meta.url)));
}

export function resolveProjectDir(input?: string): string {
  if (input && isAbsolute(input)) return input;
  if (input) return resolve(process.cwd(), input);
  return resolve(packageRoot(), "..", "..", "..", "analysis");
}

export class AnalysisClient {
  private procs: ChildProcess[] = [];
  private pending = new Map<string, PendingEntry>();
  private queue: AnalysisJob[] = [];
  private restarts = 0;
  private backoffMs: number;
  private lastHeartbeat: number | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private readonly opts: Required<
    Pick<
      SupervisorOptions,
      | "restartBackoffMs"
      | "jobTimeoutMs"
      | "heartbeatTimeoutMs"
      | "concurrency"
    >
  >;
  private readonly onProgress: SupervisorOptions["progress"];
  private readonly onLog: SupervisorOptions["log"];
  readonly command: string;
  readonly projectDir: string;

  constructor(command = "uv", projectDir?: string, opts: SupervisorOptions = {}) {
    this.command = command;
    this.projectDir = resolveProjectDir(projectDir);
    this.opts = {
      restartBackoffMs: opts.restartBackoffMs ?? [1000, 30000],
      jobTimeoutMs: opts.jobTimeoutMs ?? 900000,
      heartbeatTimeoutMs: opts.heartbeatTimeoutMs ?? 15000,
      concurrency: Math.max(1, opts.concurrency ?? 1),
    };
    this.backoffMs = this.opts.restartBackoffMs[0];
    this.onProgress = opts.progress;
    this.onLog = opts.log;
  }

  start(): void {
    if (this.procs.length > 0) return;
    for (let i = 0; i < this.opts.concurrency; i += 1) this.spawnOne();
    this.heartbeatTimer = setInterval(() => this.checkHeartbeat(), 1000);
  }

  analyze(req: AnalyzeRequest): Promise<AnalyzeResult> {
    const job = toJob(req);
    if (job.priority === "deck") this.queue.unshift(job);
    else this.queue.push(job);
    const { promise, resolve, reject } = Promise.withResolvers<AnalyzeResult>();
    job.state = "Queued";
    this.pending.set(job.id, { job, resolve, reject, timer: undefined });
    this.drain();
    return promise;
  }

  cancel(id: string): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.send({ v: PROTOCOL_VERSION, id, type: "cancel" });
    this.failEntry(entry, "worker-timeout", "cancelled by request id");
    return true;
  }

  handleMessage(msg: {
    type: string;
    id?: string;
    trackId?: string;
    artifactPath?: string;
    error?: string;
    reason?: string;
    stage?: string;
  }): void {
    const frame = msg as ProtocolFrame;
    if (frame.type === "heartbeat" || frame.v === PROTOCOL_VERSION) {
      if (frame.type === "heartbeat") {
        this.lastHeartbeat = Date.now();
        return;
      }
      const routed = frameId(frame);
      const entry = routed ? this.findEntry(routed) : undefined;
      if (!entry) return;
      this.routeFrame(entry, {
        type: String(frame.type),
        id: routed,
        artifactPath:
          typeof frame["artifactPath"] === "string"
            ? (frame["artifactPath"] as string)
            : undefined,
        error:
          typeof frame["reason"] === "string"
            ? (frame["reason"] as string)
            : typeof frame["error"] === "string"
              ? (frame["error"] as string)
              : undefined,
        stage: typeof frame["stage"] === "string" ? (frame["stage"] as string) : undefined,
      });
      return;
    }
    const legacyId = msg.trackId ?? msg.id;
    if (!legacyId) return;
    const entry = this.findEntry(legacyId);
    if (!entry) return;
    this.routeFrame(entry, msg);
  }

  pendingCount(): number {
    return this.pending.size;
  }

  requeue(req: AnalyzeRequest): void {
    this.queue.unshift(toJob(req));
  }

  queuedCount(): number {
    return this.queue.length;
  }

  status(): SupervisorStatus {
    return {
      running: this.procs.length > 0,
      restarts: this.restarts,
      pending: this.pending.size,
      queued: this.queue.length,
      lastHeartbeat: this.lastHeartbeat,
    };
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    for (const proc of this.procs) {
      try {
        proc.kill();
      } catch {
        /* teardown never throws */
      }
    }
    this.procs = [];
  }

  private findEntry(routed: string): PendingEntry | undefined {
    return (
      this.pending.get(routed) ??
      [...this.pending.values()].find((e) => e.job.trackId === routed)
    );
  }

  private routeFrame(
    entry: PendingEntry,
    msg: { type: string; id?: string; artifactPath?: string; error?: string; stage?: string },
  ): void {
    if (msg.type === "progress" && msg.stage) {
      entry.job.state = "Analyzing";
      if (this.onProgress) this.onProgress(entry.job, msg.stage);
      return;
    }
    if (msg.type === "complete" && msg.artifactPath) {
      entry.job.state = "Ready";
      this.clearEntry(entry);
      entry.resolve({
        type: "complete",
        trackId: entry.job.trackId,
        artifactPath: msg.artifactPath,
      });
      this.drain();
      return;
    }
    const code = classifyError(msg.error ?? "analysis failed");
    entry.job.state = "Failed";
    entry.job.lastError = { code, message: msg.error ?? "analysis failed" };
    this.clearEntry(entry);
    entry.reject(new Error(msg.error ?? "analysis failed"));
    this.drain();
  }

  private clearEntry(entry: PendingEntry): void {
    this.pending.delete(entry.job.id);
    if (entry.timer) clearTimeout(entry.timer);
  }

  private failEntry(entry: PendingEntry, code: AnalyzeErrorCode, message: string): void {
    entry.job.state = "Failed";
    entry.job.lastError = { code, message };
    this.clearEntry(entry);
    entry.reject(new Error(message));
  }

  private drain(): void {
    if (this.procs.length === 0) return;
    const inFlight = [...this.pending.values()].filter((e) => e.timer !== undefined).length;
    const capacity = this.procs.length - inFlight;
    for (let i = 0; i < capacity; i += 1) {
      const job = this.queue.shift();
      if (!job) return;
      const entry = this.pending.get(job.id);
      if (!entry) continue;
      job.state = "Analyzing";
      job.attempts += 1;
      entry.timer = setTimeout(() => {
        this.failEntry(entry, "worker-timeout", `job exceeded ${this.opts.jobTimeoutMs}ms`);
        this.restartWithBackoff();
      }, this.opts.jobTimeoutMs);
      this.send({
        v: PROTOCOL_VERSION,
        id: job.id,
        type: "analyze",
        trackId: job.trackId,
        audioPath: job.audioPath,
        nativeMetadataPath: job.nativeMetadataPath,
        stages: job.stages,
        configHash: job.configHash,
      });
    }
  }

  private send(msg: unknown): void {
    const proc = this.procs[0];
    try {
      proc?.stdin?.write(`${JSON.stringify(msg)}\n`);
    } catch {
      /* a dead pipe surfaces via the exit handler */
    }
  }

  private spawnOne(): void {
    let proc: ChildProcess;
    try {
      proc = spawn(
        this.command,
        ["run", "--project", this.projectDir, "python", "-m", "autolight_analysis.worker"],
        { stdio: ["pipe", "pipe", "inherit"] },
      );
    } catch (err) {
      if (this.onLog) this.onLog("spawn-failed", err);
      return;
    }
    this.procs.push(proc);
    const rl = createInterface({ input: proc.stdout! });
    rl.on("line", (line: string) => {
      try {
        this.handleMessage(parseFrame(line));
      } catch {
        if (this.onLog) this.onLog("malformed-frame", line.slice(0, 120));
      }
    });
    proc.on("error", (err: Error) => {
      if (this.onLog) this.onLog("spawn-failed", String(err));
      this.removeProc(proc);
    });
    proc.on("exit", () => {
      this.removeProc(proc);
      // Interrupted jobs keep identical inputs and go back to the head (spec 109).
      const interrupted = [...this.pending.values()].filter((e) => e.timer !== undefined);
      for (const entry of interrupted) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = undefined;
        entry.job.state = "Queued";
        this.queue.unshift(entry.job);
      }
      if (this.procs.length === 0) this.restartWithBackoff();
      else this.drain();
    });
  }

  private removeProc(proc: ChildProcess): void {
    this.procs = this.procs.filter((p) => p !== proc);
  }

  private restartWithBackoff(): void {
    this.stop();
    this.restarts += 1;
    const wait = Math.min(this.backoffMs, this.opts.restartBackoffMs[1]);
    this.backoffMs = Math.min(this.backoffMs * 2, this.opts.restartBackoffMs[1]);
    setTimeout(() => this.start(), wait);
  }

  private checkHeartbeat(): void {
    if (this.lastHeartbeat === null || this.procs.length === 0) return;
    if (Date.now() - this.lastHeartbeat > this.opts.heartbeatTimeoutMs) {
      if (this.onLog) this.onLog("heartbeat-timeout", null);
      this.restartWithBackoff();
    }
  }
}

export { computeReadiness };

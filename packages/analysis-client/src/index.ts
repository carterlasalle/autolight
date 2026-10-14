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
  type ProtocolFrame,
} from "./protocol.js";
import { computeReadiness } from "./readiness.js";

export type {
  AnalyzeRequest,
  AnalyzeResult,
  AnalyzeErrorCode,
  AnalysisJob,
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
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Worker this job was dispatched to; null while queued. */
  proc: ChildProcess | null;
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

function resolveProjectDir(input?: string): string {
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
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
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
    if (this.restartTimer !== undefined) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    this.stopped = false;
    if (this.procs.length > 0) return;

    this.lastHeartbeat = Date.now();
    for (let i = 0; i < this.opts.concurrency; i += 1) this.spawnOne();
    this.heartbeatTimer = setInterval(() => this.checkHeartbeat(), 1000);
    this.drain();
  }

  analyze(req: AnalyzeRequest): Promise<AnalyzeResult> {
    const job = toJob(req);

    if (job.priority === "deck") this.queue.unshift(job);
    else this.queue.push(job);
    const { promise, resolve, reject } = Promise.withResolvers<AnalyzeResult>();
    job.state = "Queued";
    this.pending.set(job.id, { job, resolve, reject, timer: undefined, proc: null });
    this.drain();

    return promise;
  }

  cancel(id: string): boolean {
    const entry = this.pending.get(id);

    if (!entry) return false;
    // Route the cancel to the worker holding the job when dispatched, so a
    // sibling worker never sees a cancel for a job it does not own.
    this.send({ v: PROTOCOL_VERSION, id, type: "cancel" }, entry.proc ?? undefined);
    this.failEntry(entry, "cancelled", "cancelled by request id");

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

    // Any framed line proves the worker loop is alive; the heartbeat
    // timestamp tracks liveness, not just explicit heartbeat frames.
    this.lastHeartbeat = Date.now();
    this.backoffMs = this.opts.restartBackoffMs[0];

    if (frame.type === "heartbeat" || frame.v === PROTOCOL_VERSION) {
      if (frame.type === "heartbeat") return;

      const routed = frameId(frame);

      if (routed === undefined) return;
      const entry = this.findEntry(routed);

      if (!entry) return;

      const routedMsg: { type: string; id: string; artifactPath?: string; error?: string; stage?: string } = {
        type: String(frame.type),
        id: routed,
      };

      if (typeof frame["artifactPath"] === "string") routedMsg.artifactPath = frame["artifactPath"] as string;

      if (typeof frame["reason"] === "string") routedMsg.error = frame["reason"] as string;
      else if (typeof frame["error"] === "string") routedMsg.error = frame["error"] as string;

      if (typeof frame["stage"] === "string") routedMsg.stage = frame["stage"] as string;
      this.routeFrame(entry, routedMsg);

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

  /** Pending job ids in insertion order — the tests' handle on routing. */
  jobIds(): string[] {
    return [...this.pending.keys()];
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
    this.stopped = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.restartTimer !== undefined) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }

    for (const proc of this.procs) {
      try {
        proc.kill();
      } catch {
        /* teardown never throws */
      }
    }

    this.procs = [];
    // Reject in-flight promises so stop() never resurrects itself through
    // armed job timers or the exit handlers of the killed workers.
    for (const entry of this.pending.values()) {
      if (entry.timer !== undefined) {
        clearTimeout(entry.timer);
        entry.timer = undefined;
      }
      entry.proc = null;
      entry.job.state = "Failed";
      entry.job.lastError = { code: "worker-exited", message: "supervisor stopped" };
      entry.reject(new Error("supervisor stopped"));
    }

    this.pending.clear();
    this.lastHeartbeat = null;
  }

  private findEntry(routed: string): PendingEntry | undefined {
    const direct = this.pending.get(routed);

    if (direct !== undefined) return direct;
    // trackId routing is ambiguous when a track is analyzed twice while the
    // first job is still pending, so it only resolves when unambiguous.
    const matches = [...this.pending.values()].filter((e) => e.job.trackId === routed);

    return matches.length === 1 ? matches[0] : undefined;
  }

  private routeFrame(
    entry: PendingEntry,
    msg: { type: string; id?: string; artifactPath?: string; error?: string; stage?: string },
  ): void {
    if (msg.type === "progress") {
      if (msg.stage === undefined) return;
      entry.job.state = "Analyzing";

      if (this.onProgress) this.onProgress(entry.job, msg.stage);

      return;
    }

    if (msg.type === "complete") {
      if (msg.artifactPath === undefined) return;
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

    if (msg.type === "cancelled") {
      // The worker acknowledges our cancel; the local promise already
      // rejected in cancel(), so a late ack is just queue hygiene.
      if (!this.pending.has(entry.job.id)) return;
      this.failEntry(entry, "cancelled", "cancelled by request id");
      this.drain();

      return;
    }

    if (msg.type !== "failed" && msg.type !== "error") return;
    const code = classifyError(msg.error ?? "analysis failed");
    entry.job.state = "Failed";
    entry.job.lastError = { code, message: msg.error ?? "analysis failed" };
    this.clearEntry(entry);
    entry.reject(new Error(msg.error ?? "analysis failed"));
    this.drain();
  }

  private dequeue(job: AnalysisJob): void {
    const at = this.queue.findIndex((j) => j.id === job.id);

    if (at >= 0) this.queue.splice(at, 1);
  }

  private clearEntry(entry: PendingEntry): void {
    this.pending.delete(entry.job.id);
    this.dequeue(entry.job);

    if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
    entry.proc = null;
  }

  private failEntry(entry: PendingEntry, code: AnalyzeErrorCode, message: string): void {
    entry.job.state = "Failed";
    entry.job.lastError = { code, message };
    this.clearEntry(entry);
    entry.reject(new Error(message));
    this.drain();
  }

  private drain(): void {
    if (this.stopped || this.procs.length === 0) return;
    const busy = new Set<ChildProcess>();

    for (const e of this.pending.values()) {
      if (e.timer !== undefined && e.proc !== null) busy.add(e.proc);
    }
    const idle = this.procs.filter((p) => !busy.has(p));

    for (const proc of idle) {
      const job = this.queue.shift();

      if (!job) return;
      const entry = this.pending.get(job.id);

      if (entry === undefined) continue;
      if (entry.timer !== undefined) {
        // Already dispatched; a stale shift must not double-dispatch.
        this.queue.unshift(job);
        continue;
      }
      job.state = "Analyzing";
      job.attempts += 1;
      entry.proc = proc;
      entry.timer = setTimeout(() => {
        this.failEntry(entry, "worker-timeout", `job exceeded ${this.opts.jobTimeoutMs}ms`);
        this.restartWithBackoff();
      }, this.opts.jobTimeoutMs);
      this.send(
        {
          v: PROTOCOL_VERSION,
          id: job.id,
          type: "analyze",
          trackId: job.trackId,
          audioPath: job.audioPath,
          nativeMetadataPath: job.nativeMetadataPath,
          stages: job.stages,
          configHash: job.configHash,
        },
        proc,
      );
    }
  }

  private send(msg: unknown, proc?: ChildProcess): void {
    const target = proc ?? this.procs[0];

    try {
      target?.stdin?.write(`${JSON.stringify(msg)}\n`);
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
    // Fresh workers have not emitted their first heartbeat yet; the spawn
    // timestamp is the grace window so checkHeartbeat cannot fail them.
    this.lastHeartbeat = Date.now();
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
      if (this.stopped) return;
      // Interrupted jobs keep identical inputs and go back to the head (spec 109).
      // Only jobs actually dispatched to the exiting worker are requeued;
      // jobs on surviving siblings keep running.
      const interrupted = [...this.pending.values()].filter((e) => e.proc === proc);

      for (const entry of interrupted) {
        if (entry.timer !== undefined) {
          clearTimeout(entry.timer);
          entry.timer = undefined;
        }
        entry.proc = null;
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
    if (this.stopped || this.restartTimer !== undefined) return;
    this.restarts += 1;
    const wait = Math.min(this.backoffMs, this.opts.restartBackoffMs[1]);
    this.backoffMs = Math.min(this.backoffMs * 2, this.opts.restartBackoffMs[1]);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.start();
    }, wait);
  }

  private checkHeartbeat(): void {
    if (this.stopped) return;
    // A fresh worker has not emitted its first heartbeat yet; the spawn
    // timestamp set in start()/spawnOne() is its grace window, not a failure.
    if (this.lastHeartbeat === null || this.procs.length === 0) return;

    if (Date.now() - this.lastHeartbeat > this.opts.heartbeatTimeoutMs) {
      if (this.onLog) this.onLog("heartbeat-timeout", null);
      this.restartWithBackoff();
    }
  }
}

export { computeReadiness };

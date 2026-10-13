import { Worker } from "node:worker_threads";
import { ServiceTracker, messageOf, type Service, type ServiceStatus } from "./base.js";
import { setHostIntentForwarder, setShowHostMetricsReader } from "../show-service.js";

// show-host-supervisor (DS-07 worker-thread mode, spec 56/86): the only
// component allowed to spawn the show host worker thread. The 60 Hz tick
// pipeline (packages/show-host/src/worker-entry.ts, process.hrtime.bigint
// monotonic clock) runs isolated from main: a frozen main thread stalls only
// message delivery, never the tick. Master intents flow main -> worker
// through the typed host protocol via setHostIntentForwarder; snapshots and
// jitter metrics (getMetrics intervalP50/P99/max) flow back over the port
// and surface in diagnostics/all.

export interface ShowHostPort {
  postMessage(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
  /** Optional: a port that can observe worker errors reports them here. A
   * worker that dies without this channel would leave the service claiming to
   * run, so the Node adapter implements it and the supervisor degrades on it. */
  onFailure?(listener: (reason: string) => void): void;
  terminate(): Promise<number> | void;
}

export interface ShowHostSupervisorOptions {
  workerEntryUrl: string;
  tickHz?: number;
  uiRateHz?: number;
  maxBytes?: number;
  createWorker?: () => ShowHostPort;
}

export interface HostMetricsSnapshot {
  ticks: number;
  snapshotsPublished: number;
  supersededFrames: number;
  intervalP50Ms: number;
  intervalP99Ms: number;
  intervalMaxMs: number;
  missedTicksPerHour: number;
}

// Every field of a snapshot is a number, so checking them all as finite
// numbers is exactly what makes an unparsed payload a HostMetricsSnapshot: a
// missing or non-numeric field would spread NaN through diagnostics.
const METRICS_FIELDS: readonly (keyof HostMetricsSnapshot)[] = [
  "ticks",
  "snapshotsPublished",
  "supersededFrames",
  "intervalP50Ms",
  "intervalP99Ms",
  "intervalMaxMs",
  "missedTicksPerHour",
];

function isMetricsMessage(message: unknown): message is { type: "metrics"; metrics: HostMetricsSnapshot } {
  if (message === null || typeof message !== "object") return false;

  if (!("type" in message) || message.type !== "metrics") return false;

  if (!("metrics" in message) || message.metrics === null || typeof message.metrics !== "object") return false;

  // SAFETY: every field of a snapshot is a number, so verifying them all as
  // finite numbers is what establishes this payload as a HostMetricsSnapshot.
  const metrics = message.metrics as HostMetricsSnapshot;

  return METRICS_FIELDS.every((field) => Number.isFinite(metrics[field]));
}

// Node Worker speaks on()/postMessage()/terminate(); the supervisor seam
// speaks postMessage()/onMessage()/terminate(). One adapter, at the
// construction boundary only.
function workerPortFrom(worker: Worker): ShowHostPort {
  return {
    postMessage: (message: unknown) => { worker.postMessage(message); },
    onMessage: (listener: (message: unknown) => void) => { worker.on("message", listener); },
    onFailure: (listener: (reason: string) => void) => {
      worker.on("error", (error: Error) => listener(`show host worker error: ${messageOf(error)}`));
      worker.on("exit", (code: number) => listener(`show host worker exited with code ${code}`));
    },
    terminate: () => worker.terminate(),
  };
}

export class ShowHostSupervisor implements Service {
  readonly name = "show-host-supervisor";
  private readonly tracker = new ServiceTracker("show-host-supervisor");
  private worker: ShowHostPort | null = null;
  private spawned = false;
  private accepting = false;
  private lastMetrics: HostMetricsSnapshot | null = null;
  private readonly opts: ShowHostSupervisorOptions;

  constructor(opts: ShowHostSupervisorOptions) {
    this.opts = opts;
  }

  start(): ServiceStatus {
    // Lazy spawn: the worker starts with the first intent or explicit
    // ensureStarted so a broken entry URL cannot block boot (spec 132
    // degraded stage). Master intents forward from the first start, and only
    // while started: an intent arriving after stop() must not respawn the
    // worker thread the owner believes is gone.
    this.accepting = true;
    setHostIntentForwarder((channel, request) => {
      if (!this.accepting) return;
      this.ensureWorker()?.postMessage({ type: "intent", channel, request });
    });
    // §131: diagnostics/all reads the tick jitter through this reader.
    setShowHostMetricsReader(() => this.metrics());
    this.tracker.set("running", "show host spawns on first intent");

    return this.status();
  }

  stop(): ServiceStatus {
    try {
      const stopping = this.worker?.terminate();

      if (stopping !== undefined && typeof (stopping as Promise<number>).then === "function") {
        void (stopping as Promise<number>).catch(() => undefined);
      }
    } catch { /* teardown never throws */ }

    this.worker = null;
    this.spawned = false;
    // The installed forwarder stays in place but is inert from here on; the
    // metrics reader goes away with the worker it read.
    this.accepting = false;
    setShowHostMetricsReader(() => null);
    this.tracker.set("stopped");

    return this.status();
  }

  status(): ServiceStatus {
    this.tracker.setCounter("spawned", this.spawned ? 1 : 0);
    const metrics = this.lastMetrics;

    if (metrics !== null) {
      this.tracker.setCounter("ticks", metrics.ticks);
      this.tracker.setCounter("intervalP99Ms", Math.round(metrics.intervalP99Ms * 1000) / 1000);
      this.tracker.setCounter("missedTicksPerHour", Math.round(metrics.missedTicksPerHour * 100) / 100);
    }

    return this.tracker.status();
  }

  metrics(): HostMetricsSnapshot | null {
    return this.lastMetrics;
  }

  ensureStarted(): void {
    this.ensureWorker();
  }

  private ensureWorker(): ShowHostPort | null {
    if (this.worker !== null) return this.worker;

    let worker: ShowHostPort;

    try {
      worker = this.opts.createWorker?.() ?? workerPortFrom(new Worker(this.opts.workerEntryUrl, {
        workerData: {
          mode: "worker-thread",
          ...(this.opts.tickHz !== undefined ? { tickHz: this.opts.tickHz } : {}),
          ...(this.opts.uiRateHz !== undefined ? { uiRateHz: this.opts.uiRateHz } : {}),
          ...(this.opts.maxBytes !== undefined ? { maxBytes: this.opts.maxBytes } : {}),
        },
      }));
    } catch (err) {
      // A broken entry URL degrades the service instead of failing boot (spec
      // 132); the next intent retries the spawn.
      this.tracker.set("degraded", `show host worker spawn failed: ${messageOf(err)}`);

      return null;
    }

    worker.onFailure?.((reason) => { this.handleWorkerFailure(worker, reason); });

    let tapping = true;

    try {
      worker.onMessage((message) => {
        if (isMetricsMessage(message)) this.lastMetrics = message.metrics;
      });
    } catch (err) {
      // No tap means no metrics: stay degraded rather than overwrite it with
      // a healthy "running" the moment the spawn succeeded.
      tapping = false;
      this.tracker.set("degraded", `show host worker message tap failed: ${messageOf(err)}`);
    }

    this.worker = worker;

    if (!this.spawned) {
      this.spawned = true;

      if (tapping) this.tracker.set("running", "show host worker thread live");
    }

    return worker;
  }

  /** True when this supervisor was built for the same worker configuration. */
  matches(opts: ShowHostSupervisorOptions): boolean {
    return this.opts.workerEntryUrl === opts.workerEntryUrl
      && this.opts.tickHz === opts.tickHz
      && this.opts.uiRateHz === opts.uiRateHz
      && this.opts.maxBytes === opts.maxBytes;
  }

  // A worker that errors or exits after the spawn is gone: the tick pipeline
  // no longer runs, so the service degrades and the next intent respawns.
  private handleWorkerFailure(failed: ShowHostPort, reason: string): void {
    if (this.worker !== failed) return;

    this.worker = null;
    this.spawned = false;
    this.tracker.set("degraded", reason);
  }
}

let instance: ShowHostSupervisor | null = null;

export function getShowHostSupervisor(opts: ShowHostSupervisorOptions): ShowHostSupervisor {
  if (instance !== null && !instance.matches(opts)) {
    // Different worker options: stopping the old instance is the only honest
    // answer, keeping it would run the caller's config never.
    instance.stop();
    instance = null;
  }

  instance ??= new ShowHostSupervisor(opts);

  return instance;
}

export function resetShowHostSupervisorForTest(): void {
  // Terminate the worker: dropping the reference alone leaks a thread.
  instance?.stop();
  instance = null;
}

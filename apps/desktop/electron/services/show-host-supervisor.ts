import { Worker } from "node:worker_threads";
import { ServiceTracker, messageOf, type Service, type ServiceStatus } from "./base.js";
import { setHostIntentForwarder } from "../show-service.js";

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

function isMetricsMessage(message: unknown): message is { type: "metrics"; metrics: HostMetricsSnapshot } {
  if (message === null || typeof message !== "object") return false;

  if (!("type" in message) || message.type !== "metrics") return false;

  return "metrics" in message && message.metrics !== null && typeof message.metrics === "object";
}

// Node Worker speaks on()/postMessage()/terminate(); the supervisor seam
// speaks postMessage()/onMessage()/terminate(). One adapter, at the
// construction boundary only.
function workerPortFrom(worker: Worker): ShowHostPort {
  return {
    postMessage: (message: unknown) => { worker.postMessage(message); },
    onMessage: (listener: (message: unknown) => void) => { worker.on("message", listener); },
    terminate: () => worker.terminate(),
  };
}

export class ShowHostSupervisor implements Service {
  readonly name = "show-host-supervisor";
  private readonly tracker = new ServiceTracker("show-host-supervisor");
  private worker: ShowHostPort | null = null;
  private spawned = false;
  private lastMetrics: HostMetricsSnapshot | null = null;
  private readonly opts: ShowHostSupervisorOptions;

  constructor(opts: ShowHostSupervisorOptions) {
    this.opts = opts;
  }

  start(): ServiceStatus {
    // Lazy spawn: the worker starts with the first intent or explicit
    // ensureStarted so a broken entry URL cannot block boot (spec 132
    // degraded stage). Master intents forward from the first start.
    setHostIntentForwarder((channel, request) => {
      this.ensureWorker().postMessage({ type: "intent", channel, request });
    });
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

  private ensureWorker(): ShowHostPort {
    if (this.worker !== null) return this.worker;

    const worker: ShowHostPort = this.opts.createWorker?.() ?? workerPortFrom(new Worker(this.opts.workerEntryUrl, {
      workerData: {
        mode: "worker-thread",
        ...(this.opts.tickHz !== undefined ? { tickHz: this.opts.tickHz } : {}),
        ...(this.opts.uiRateHz !== undefined ? { uiRateHz: this.opts.uiRateHz } : {}),
        ...(this.opts.maxBytes !== undefined ? { maxBytes: this.opts.maxBytes } : {}),
      },
    }));

    try {
      worker.onMessage((message) => {
        if (isMetricsMessage(message)) this.lastMetrics = message.metrics;
      });
    } catch (err) {
      this.tracker.set("degraded", `show host worker message tap failed: ${messageOf(err)}`);
    }

    this.worker = worker;

    if (!this.spawned) {
      this.spawned = true;
      this.tracker.set("running", "show host worker thread live");
    }

    return worker;
  }
}

let instance: ShowHostSupervisor | null = null;

export function getShowHostSupervisor(opts: ShowHostSupervisorOptions): ShowHostSupervisor {
  instance ??= new ShowHostSupervisor(opts);

  return instance;
}

export function resetShowHostSupervisorForTest(): void {
  instance = null;
}

import { ServiceTracker, messageOf, type Service, type ServiceStatus } from "./base.js";

// matter-bridge (04-target-architecture section 1): the main-process side of
// the Matter controller. The controller itself runs in a utility process
// (04-target-architecture section 1, "MATTER UTILITY PROCESS") so its crashes
// cannot touch the show; this service only owns that process and the message
// relay. No Matter traffic on the show tick.

export interface MatterProcessPort {
  name: string;
  postMessage(msg: unknown): void;
  onMessage(listener: (msg: unknown) => void): void;
  onExit(listener: (code: number | null) => void): void;
  kill(): void;
}

export interface MatterBridgeOptions {
  spawn?: () => MatterProcessPort;
  // Restart policy: the bridge restarts the controller and reports it.
  maxRestarts?: number;
}

export class MatterBridge implements Service {
  readonly name = "matter-bridge";
  private readonly tracker = new ServiceTracker("matter-bridge");
  private port: MatterProcessPort | null = null;
  private restarts = 0;
  private readonly inbound: unknown[] = [];
  private readonly listeners = new Set<(msg: unknown) => void>();
  private readonly opts: MatterBridgeOptions;

  constructor(opts: MatterBridgeOptions = {}) {
    this.opts = opts;
  }

  start(): ServiceStatus {
    if (this.port !== null) return this.status();
    try {
      const port = this.opts.spawn?.();
      if (port === undefined) {
        this.tracker.set("degraded", "Matter utility process not wired (controller lands with the Matter task)");
        return this.status();
      }
      port.onMessage((msg) => {
        this.tracker.count("inbound");
        this.inbound.push(msg);
        if (this.inbound.length > 64) this.inbound.shift();
        for (const listener of this.listeners) listener(msg);
      });
      port.onExit((code) => {
        this.tracker.count("exits");
        this.port = null;
        const limit = this.opts.maxRestarts ?? 3;
        if (this.restarts >= limit) {
          this.tracker.set("degraded", `Matter controller exited (code ${code ?? "unknown"}); restart limit ${limit} reached`);
          return;
        }
        this.restarts += 1;
        this.tracker.count("restarts");
        this.start();
      });
      this.port = port;
      this.tracker.set("running", `controller process ${port.name}`);
    } catch (err) {
      this.tracker.set("degraded", `Matter controller failed to start: ${messageOf(err)}`);
    }
    return this.status();
  }

  stop(): ServiceStatus {
    try {
      this.port?.kill();
    } catch { /* teardown never throws */ }
    this.port = null;
    this.tracker.set("stopped");
    return this.status();
  }

  status(): ServiceStatus {
    this.tracker.setCounter("process", this.port === null ? 0 : 1);
    this.tracker.setCounter("restarts", this.restarts);
    return this.tracker.status();
  }

  send(msg: unknown): boolean {
    if (this.port === null) return false;
    this.port.postMessage(msg);
    this.tracker.count("outbound");
    return true;
  }

  onMessage(listener: (msg: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  recentMessages(): unknown[] {
    return [...this.inbound];
  }
}

let instance: MatterBridge | null = null;

export function getMatterBridge(opts: MatterBridgeOptions = {}): MatterBridge {
  instance ??= new MatterBridge(opts);
  return instance;
}

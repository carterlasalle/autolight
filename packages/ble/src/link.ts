// BLE link manager and pacing (T-BLE-03; WP04 link manager and pacing).
//
// Sources: WP04 which cites govee-toolkit docs/protocol/ble.md (one
// connection at a time, advertise gap, write budget per devices/H61A0.yaml)
// and devices/H6008.yaml (render_hold_ms). One link per device, reconnect with
// backoff, advertising gap tolerance, notify subscription, write pacing
// against the unit's measured write_budget_hz (default
// govee.ble.writeBudgetHzDefault with an "unmeasured" badge), link held at
// least write_drain_ms after the last write before an intentional
// disconnect, newest-state-wins, and a burst guard that never exceeds the
// budget under catch-up.
//
// The clock is injected so tests run deterministically: no real timers here.
// No claim here measures the owner's units; sim runs prove code, never hardware.
import { BLE_DEFAULTS, BLE_WRITE_BUDGET_UNMEASURED_BADGE } from "./constants.js";
import type { BleAdapter, BleConnection } from "./backends.js";

export type BleTimer = number;

export interface BleClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): BleTimer;
  clearTimeout(handle: BleTimer): void;
}

const wallClock: BleClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => Number(setTimeout(fn, Math.max(0, ms))),
  clearTimeout: () => undefined,
};

export interface BleLinkPerDeviceConfig {
  /** Measured writes per second for the unit, or null for the default. */
  writeBudgetHz: number | null;
  /** Hold after the last write before an intentional disconnect. */
  writeDrainMs?: number;
  /** Silent window tolerated before a reconnect starts. */
  advertiseGapMs?: number;
  /** Backoff steps for reconnect, in ms. */
  backoffMs?: readonly number[];
}

export interface BleLinkStatus {
  state: "connected" | "reconnecting" | "closed";
  budgetHz: number;
  budgetBadge: string | null;
  pendingWrites: number;
  writesSent: number;
  writesSuperseded: number;
  writesDroppedBudget: number;
  reconnects: number;
}

interface QueuedWrite {
  frame: Uint8Array;
  at: number;
}

/** One device link: newest-state-wins, paced, reconnecting, drain on close. */
export class BleLink {
  private notifyHandler: ((notify: Uint8Array) => void) | null = null;
  private connection: BleConnection | null = null;
  private state: "connected" | "reconnecting" | "closed" = "reconnecting";
  private queue: QueuedWrite[] = [];
  private lastFlushAt = 0;
  private lastWriteAt = 0;
  private lastSeenAt: number;
  private readonly budgetHz: number;
  private readonly unmeasured: boolean;
  private readonly drainMs: number;
  private readonly gapMs: number;
  private readonly backoff: readonly number[];
  private backoffIndex = 0;
  private reconnects = 0;
  private writesSent = 0;
  private superseded = 0;
  private dropped = 0;
  private drainTimer: BleTimer | null = null;
  private reconnectTimer: BleTimer | null = null;
  private closed = false;

  constructor(
    readonly address: string,
    private readonly adapter: BleAdapter,
    config: BleLinkPerDeviceConfig,
    private readonly clock: BleClock = wallClock,
  ) {
    this.unmeasured = config.writeBudgetHz === null || config.writeBudgetHz === undefined;
    this.budgetHz = config.writeBudgetHz ?? BLE_DEFAULTS.WRITE_BUDGET_HZ;
    this.drainMs = Math.max(0, config.writeDrainMs ?? BLE_DEFAULTS.WRITE_DRAIN_MS);
    this.gapMs = Math.max(0, config.advertiseGapMs ?? 5000);
    this.backoff = config.backoffMs ?? [250, 1000, 5000];
    this.lastSeenAt = this.clock.now();
  }

  get budgetBadge(): string | null {
    return this.unmeasured ? BLE_WRITE_BUDGET_UNMEASURED_BADGE : null;
  }

  /** Opens the link: connects, subscribes to notify, marks the gap clock. */
  async open(onNotify: (notify: Uint8Array) => void): Promise<void> {
    if (this.closed) throw new Error(`ble link ${this.address} is closed`);
    this.notifyHandler = onNotify;
    this.cancelReconnect();
    this.connection = await this.adapter.connect(this.address);
    this.attachNotify();
    this.state = "connected";
    this.lastFlushAt = this.clock.now();
  }

  private attachNotify(): void {
    const handler = this.notifyHandler;
    if (handler === null) return;
    this.connection?.subscribe((notify) => {
      this.lastSeenAt = this.clock.now();
      handler(notify);
    });
  }

  /**
   * Queues a write. Newest wins: when a write is still waiting for its
   * budget slot, the newcomer replaces it and the replaced one counts as
   * superseded. When no write is waiting, the newcomer flushes at once.
   */
  send(frame: Uint8Array): void {
    if (this.closed || this.state === "closed") return;
    const waiting = this.queue.length > 0;
    const now = this.clock.now();
    const spacing = 1000 / Math.max(1, this.budgetHz);
    if (!waiting && now - this.lastFlushAt >= spacing) {
      this.lastFlushAt = now;
      this.lastWriteAt = now;
      this.lastSeenAt = now;
      const connection = this.connection;
      this.writesSent += 1;
      if (connection !== null) {
        void connection.write(frame.slice()).catch(() => {
          this.onDrop();
        });
      }
      return;
    }
    if (waiting) this.superseded += 1;
    this.queue = [{ frame: frame.slice(), at: now }];
    this.pump();
  }

  /** Emits due writes without ever exceeding the budget, even under catch-up. */
  private pump(): void {
    if (this.connection === null || this.state !== "connected") return;
    const spacing = 1000 / Math.max(1, this.budgetHz);
    const now = this.clock.now();
    const head = this.queue[0];
    if (head === undefined) return;
    if (now - this.lastFlushAt < spacing) return;
    this.lastFlushAt = now;
    this.lastWriteAt = now;
    this.lastSeenAt = now;
    const { frame } = head;
    this.queue = [];
    const connection = this.connection;
    this.writesSent += 1;
    void connection.write(frame).catch(() => {
      this.onDrop();
    });
  }

  /** Test and scheduler tick: flush a due write, or start a reconnect past the gap. */
  tick(): void {
    this.pump();
    if (this.state === "connected" && this.connection !== null && this.clock.now() - this.lastSeenAt > this.gapMs) {
      void this.reconnect();
    }
  }

  /** True while the link must stay open: queued writes or inside the drain window. */
  get busy(): boolean {
    return this.queue.length > 0 || this.clock.now() - this.lastWriteAt < this.drainMs;
  }

  /** Closes the link, holding it for the drain window after the last write. */
  async close(): Promise<void> {
    this.closed = true;
    this.cancelReconnect();
    if (this.drainTimer !== null) {
      this.clock.clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    const wait = Math.max(0, this.lastWriteAt + this.drainMs - this.clock.now());
    if (wait > 0 && this.connection !== null) {
      await new Promise<void>((resolve) => {
        this.drainTimer = this.clock.setTimeout(() => {
          this.drainTimer = null;
          resolve();
        }, wait);
      });
    }
    this.queue = [];
    const connection = this.connection;
    this.connection = null;
    this.state = "closed";
    if (connection !== null) await connection.disconnect();
  }

  private onDrop(): void {
    this.dropped += 1;
    this.connection = null;
    if (!this.closed) void this.reconnect();
  }

  private async reconnect(): Promise<void> {
    if (this.closed || this.state === "reconnecting") return;
    this.state = "reconnecting";
    const stale = this.connection;
    this.connection = null;
    if (stale !== null) await stale.disconnect().catch(() => undefined);
    if (this.closed) return;
    this.reconnects += 1;
    const delay = this.backoff[Math.min(this.backoffIndex, this.backoff.length - 1)] ?? 1000;
    this.backoffIndex += 1;
    try {
      await new Promise<void>((resolve) => {
        this.reconnectTimer = this.clock.setTimeout(() => {
          this.reconnectTimer = null;
          resolve();
        }, delay);
      });
    } catch {
      return;
    }
    if (this.closed) return;
    await this.finishReconnect();
  }

  private async finishReconnect(): Promise<void> {
    try {
      this.connection = await this.adapter.connect(this.address);
      this.attachNotify();
      this.state = "connected";
      this.backoffIndex = 0;
      this.lastSeenAt = this.clock.now();
      this.lastFlushAt = this.clock.now();
      this.pump();
    } catch {
      if (this.closed) return;
      if (this.state !== "reconnecting") {
        void this.reconnect();
        return;
      }
      this.state = "connected";
      void this.reconnect();
    }
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      this.clock.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  status(): BleLinkStatus {
    return {
      state: this.state,
      budgetHz: this.budgetHz,
      budgetBadge: this.budgetBadge,
      pendingWrites: this.queue.length,
      writesSent: this.writesSent,
      writesSuperseded: this.superseded,
      writesDroppedBudget: this.dropped,
      reconnects: this.reconnects,
    };
  }
}

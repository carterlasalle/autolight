// Device metrics (T-GOV-19, closes F-GOV-29; spec 99, 107, 131).
//
// Per device: frames requested, sent, superseded, effective FPS, status RTT,
// last response time, health state, current transport and engine, reconnect
// count. The collector merges engine counters (T-GOV-03/08), read-back RTT
// (T-GOV-07) and manager health (T-GOV-06) into one row the Devices screen,
// Diagnostics and the session recorder can read. No new transport, no new
// socket, just the counters in one place.
export type DeviceHealthState = "online" | "degraded" | "offline";

export interface DeviceMetricsRow {
  hardwareId: string;
  framesRequested: number;
  framesSent: number;
  framesSuperseded: number;
  effectiveFps: number;
  statusRttMs: number | null;
  lastResponseAtMs: number | null;
  health: DeviceHealthState;
  transport: string;
  engine: string;
  reconnects: number;
}

export interface MetricsSample {
  framesRequested?: number;
  framesSent?: number;
  framesSuperseded?: number;
  effectiveFps?: number;
  statusRttMs?: number | null;
  transport?: string;
  engine?: string;
  health?: DeviceHealthState;
  clock?: () => number;
}

export class DeviceMetrics {
  private readonly rows = new Map<string, DeviceMetricsRow>();

  private rowFor(hardwareId: string): DeviceMetricsRow {
    const existing = this.rows.get(hardwareId);
    if (existing) return existing;
    const row: DeviceMetricsRow = {
      hardwareId,
      framesRequested: 0,
      framesSent: 0,
      framesSuperseded: 0,
      effectiveFps: 0,
      statusRttMs: null,
      lastResponseAtMs: null,
      health: "online",
      transport: "lan",
      engine: "native-ts",
      reconnects: 0,
    };
    this.rows.set(hardwareId, row);
    return row;
  }

  /** Merge one sample: counters accumulate, gauges replace. */
  record(hardwareId: string, sample: MetricsSample): DeviceMetricsRow {
    const row = this.rowFor(hardwareId);
    row.framesRequested += sample.framesRequested ?? 0;
    row.framesSent += sample.framesSent ?? 0;
    row.framesSuperseded += sample.framesSuperseded ?? 0;
    if (sample.effectiveFps !== undefined) row.effectiveFps = sample.effectiveFps;
    if (sample.statusRttMs !== undefined) {
      row.statusRttMs = sample.statusRttMs;
      if (sample.statusRttMs !== null) row.lastResponseAtMs = (sample.clock ?? Date.now)();
    }
    if (sample.transport !== undefined) row.transport = sample.transport;
    if (sample.engine !== undefined) row.engine = sample.engine;
    if (sample.health !== undefined) row.health = sample.health;
    return { ...row };
  }

  recordReconnect(hardwareId: string): number {
    const row = this.rowFor(hardwareId);
    row.reconnects += 1;
    return row.reconnects;
  }

  markOffline(hardwareId: string): void {
    this.rowFor(hardwareId).health = "offline";
  }

  snapshot(hardwareId: string): DeviceMetricsRow | null {
    const row = this.rows.get(hardwareId);
    return row ? { ...row } : null;
  }

  snapshotAll(): DeviceMetricsRow[] {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }
}

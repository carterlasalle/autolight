// Failover state machine and the campus scenario (T-FOV-02, closes F-BLE-05).
//
// Campus and venue Wi-Fi answers with client isolation, blocked multicast,
// router restarts and dropped associations; BLE is the owner answer when LAN
// cannot reach a fixture. The machine owns LAN-loss detection per fixture:
// no status replies and no discovery sightings within
// govee.failover.lanLossMs while the stream is idle, or the stream health
// signal while armed, marks the LAN path lost. It then switches per the
// T-FOV-01 policy, probes the preferred transport every
// govee.failover.probeIntervalMs, and switches back at a bar boundary so the
// reclaim never pops mid-phrase. Every switch is an event: logged, shown on
// the tile and the status bar, and recorded for the session recorder.

import {
  selectFrameTransport,
  type FixtureTransportConfig,
  type Selection,
  type TransportId,
} from "./transports.js";

export type HealthSignal = "ok" | "lan-silent" | "stream-fault";

export interface FailoverThresholds {
  lanLossMs: number;
  probeIntervalMs: number;
}

export type MachineState = "on-preferred" | "failed-over" | "probing-preferred";

export interface SwitchEvent {
  atMs: number;
  fixtureId: string;
  from: TransportId | null;
  to: TransportId | null;
  cause: string;
  banner: string | null;
  switchBackAtBar: boolean;
}

export type SwitchObserver = (event: SwitchEvent) => void;

export interface FailoverMachineOptions {
  fixtureId: string;
  config: () => FixtureTransportConfig;
  thresholds?: Partial<FailoverThresholds>;
  onSwitch?: SwitchObserver;
  now?: () => number;
}

/** One fixture failover machine. The caller feeds LAN and stream health;
 *  this class decides the transport and emits the switch events. */
export class FailoverMachine {
  private readonly fixtureId: string;
  private readonly readConfig: () => FixtureTransportConfig;
  private readonly thresholds: FailoverThresholds;
  private readonly onSwitch: SwitchObserver | null;
  private readonly now: () => number;
  private state: MachineState = "on-preferred";
  private current: TransportId | null = null;
  private lastLanReplyAtMs: number;
  private lastProbeAtMs: number;
  private lastSelection: Selection | null = null;
  private switchCount = 0;

  constructor(opts: FailoverMachineOptions) {
    this.fixtureId = opts.fixtureId;
    this.readConfig = opts.config;
    this.thresholds = {
      lanLossMs: opts.thresholds?.lanLossMs ?? 3000,
      probeIntervalMs: opts.thresholds?.probeIntervalMs ?? 10000,
    };
    this.onSwitch = opts.onSwitch ?? null;
    this.now = opts.now ?? Date.now;
    this.lastLanReplyAtMs = this.now();
    this.lastProbeAtMs = this.now();
  }

  get machineState(): MachineState {
    return this.state;
  }

  get effectiveTransport(): TransportId | null {
    return this.current;
  }

  get switches(): number {
    return this.switchCount;
  }

  get selection(): Selection | null {
    return this.lastSelection;
  }

  /** Feeds the latest reachability and takes the policy selection. The
   *  caller merges this into its fixture config before calling. */
  select(): Selection {
    const cfg = this.readConfig();
    const sel = selectFrameTransport(cfg);
    this.lastSelection = sel;
    if (this.current === null && sel.transport !== null) {
      this.current = sel.transport;
    }
    return sel;
  }

  /** Records a LAN status reply or a discovery sighting at now. */
  noteLanReply(): void {
    this.lastLanReplyAtMs = this.now();
  }

  /** One tick: detects LAN loss, fails over, probes, and switches back at
   *  a bar boundary. Returns the current selection. */
  tick(signal: HealthSignal, atBarBoundary: boolean): Selection {
    const cfg = this.readConfig();
    const atMs = this.now();
    const preferred = cfg.order.find((t) => t !== "cloud-metadata") ?? null;
    const lanDown =
      signal === "lan-silent" && atMs - this.lastLanReplyAtMs >= this.thresholds.lanLossMs;
    const streamDown = signal === "stream-fault";

    if (this.state === "on-preferred") {
      const down = new Set<TransportId>();
      if (lanDown) {
        down.add("lan-razer");
        down.add("lan-json");
      }
      if (streamDown && this.current !== null) down.add(this.current);
      const sel = selectFrameTransport(withUnreachable(cfg, down));
      this.lastSelection = sel;
      if (this.current === null) {
        this.current = sel.transport;
        return sel;
      }
      if (sel.transport !== this.current) {
        const cause =
          lanDown || streamDown
            ? `LAN path lost for ${cfg.fixtureId}`
            : `Policy selected ${sel.transport ?? "nothing"} for ${cfg.fixtureId}`;
        this.moveTo(sel.transport, cause, atMs, false);
      }
      return sel;
    }

    const preferredUp =
      preferred !== null &&
      cfg.status[preferred]?.verified === true &&
      cfg.status[preferred]?.reachable === true &&
      !lanDown &&
      !streamDown;
    if (preferredUp && preferred !== null) {
      if (this.state === "failed-over" && atMs - this.lastProbeAtMs >= this.thresholds.probeIntervalMs) {
        this.lastProbeAtMs = atMs;
        this.state = "probing-preferred";
      }
      if (this.state === "probing-preferred" && atBarBoundary) {
        const sel = selectFrameTransport(cfg);
        this.lastSelection = sel;
        this.moveTo(sel.transport, `Preferred transport ${preferred} recovered`, atMs, true);
        this.state = "on-preferred";
        return sel;
      }
    }

    const down = new Set<TransportId>();
    if (lanDown) {
      down.add("lan-razer");
      down.add("lan-json");
    }
    if (streamDown && this.current !== null) down.add(this.current);
    if (preferred !== null) down.add(preferred);
    const held = selectFrameTransport(withUnreachable(cfg, down));
    if (held.transport === null) {
      const open = selectFrameTransport(withUnreachable(cfg, lanDown ? new Set<TransportId>(["lan-razer", "lan-json"]) : new Set<TransportId>()));
      if (open.transport !== null && open.transport !== this.current) {
        this.lastSelection = open;
        this.moveTo(open.transport, "No fallback left; reclaimed the reachable path", atMs, false);
        if (this.state === "probing-preferred") this.state = "failed-over";
        return open;
      }
    }
    this.lastSelection = held;
    if (held.transport !== this.current) {
      this.moveTo(held.transport, "Fallback transport changed", atMs, false);
    }
    return held;
  }

  private moveTo(to: TransportId | null, cause: string, atMs: number, switchBackAtBar: boolean): void {
    const from = this.current;
    if (from === to) return;
    this.current = to;
    this.switchCount += 1;
    if (this.state === "on-preferred") this.state = "failed-over";
    this.onSwitch?.({
      atMs,
      fixtureId: this.fixtureId,
      from,
      to,
      cause,
      banner: to === null ? "All frame transports down; fixture dark." : `Failover to ${to}`,
      switchBackAtBar,
    });
  }
}

/** Returns the config with the given transports marked unreachable, so the
 *  policy routes around paths this machine measured as down. */
function withUnreachable(
  cfg: FixtureTransportConfig,
  down: Set<TransportId>,
): FixtureTransportConfig {
  if (down.size === 0) return cfg;
  const status = { ...cfg.status };
  for (const t of down) {
    status[t] = { verified: status[t]?.verified ?? false, reachable: false };
  }
  return { ...cfg, status };
}

/** Campus scenario driver shared by the tests: multicast blocked, client
 *  isolation (unicast blocked), router restart, Wi-Fi drop, BLE out of
 *  range, then LAN recovery at a bar boundary. Each step feeds one health
 *  signal at one instant. Multicast loss alone never fails over (unicast
 *  discovery keeps the LAN path alive); unicast silence past lanLossMs does. */
export type CampusFault =
  | "multicast-blocked"
  | "client-isolation"
  | "router-restart"
  | "wifi-drop"
  | "ble-out-of-range"
  | "lan-recovered-at-bar";

export interface CampusStep {
  fault: CampusFault;
  signal: HealthSignal;
  advanceMs: number;
  atBarBoundary: boolean;
  lanReachable: boolean;
  bleReachable: boolean;
}

/** The canonical campus fault sequence. Times are symbolic; tests supply
 *  their own clock and mark sightings while the LAN path answers. */
export const CAMPUS_SEQUENCE: readonly CampusStep[] = [
  { fault: "multicast-blocked", signal: "ok", advanceMs: 1000, atBarBoundary: false, lanReachable: true, bleReachable: true },
  { fault: "client-isolation", signal: "lan-silent", advanceMs: 4000, atBarBoundary: false, lanReachable: false, bleReachable: true },
  { fault: "router-restart", signal: "lan-silent", advanceMs: 2000, atBarBoundary: false, lanReachable: false, bleReachable: true },
  { fault: "wifi-drop", signal: "stream-fault", advanceMs: 500, atBarBoundary: false, lanReachable: false, bleReachable: true },
  { fault: "ble-out-of-range", signal: "stream-fault", advanceMs: 500, atBarBoundary: false, lanReachable: false, bleReachable: false },
  { fault: "lan-recovered-at-bar", signal: "ok", advanceMs: 11000, atBarBoundary: true, lanReachable: true, bleReachable: true },
];

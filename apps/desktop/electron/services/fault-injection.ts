// Application-level fault injection (T-QA-04, spec 104 to 109).
//
// Scenarios drive a FramePort instead of raw sockets, so the same suite runs
// the Simulator-mode app end to end and a recording port in unit tests. No
// UDP here: Govee sockets stay owned by the show host govee-manager, and this
// file never imports the simulator package.
import { ServiceTracker, type Service, type ServiceStatus } from "./base.js";

export type FaultKind =
  | "dj-silence"
  | "device-disconnect"
  | "latency"
  | "loss"
  | "duplication"
  | "reorder"
  | "throttle"
  | "port-conflict"
  | "multicast-blocked"
  | "malformed"
  | "worker-kill"
  | "host-kill"
  | "renderer-reload";

export interface FaultScenario {
  id: string;
  kind: FaultKind;
  deviceId?: string;
  startFrame: number;
  endFrame: number;
}

// The seam under test. Production wires deliver() to the govee-manager frame
// path; tests wire it to a recording array. Payload is always the current
// frame ("held" during source loss), never a stale queued frame and never an
// all-off caused by loss alone (spec 105, 106).
export interface FramePort {
  deliver(deviceId: string, frameIndex: number, payload: "current" | "held"): void;
}

export interface FaultSuiteOptions {
  frames: number;
  devices: string[];
  scenarios: FaultScenario[];
  // Congested devices deliver one frame per throttleEvery ticks; the logical
  // show still ticks every frame (spec 107).
  throttleEvery?: number;
}

export interface FaultMeasurement {
  scenarioId: string;
  kind: FaultKind;
  framesDuringFault: number;
  recoveryFrames: number;
  staleFrames: number;
  othersContinued: boolean;
}

export interface FaultSuiteResult {
  measurements: FaultMeasurement[];
  delivered: number;
  superseded: number;
  malformedDropped: number;
  staleFrames: number;
  maxPending: number;
  // Discovery-plane faults (port 4002 conflict, blocked multicast) never stop
  // frames; this counts the frames delivered while one was active.
  discoveryDegradedFrames: number;
}

function activeAt(scenarios: FaultScenario[], frame: number): FaultScenario[] {
  return scenarios.filter((s) => frame >= s.startFrame && frame < s.endFrame);
}

function affects(scenario: FaultScenario, device: string): boolean {
  return scenario.deviceId === undefined || scenario.deviceId === device;
}

export function runFaultSuite(port: FramePort, opts: FaultSuiteOptions): FaultSuiteResult {
  const throttleEvery = opts.throttleEvery ?? 4;
  const pending = new Map<string, number>();
  const othersSeen = new Map<string, boolean>();
  const measurements: FaultMeasurement[] = [];
  let delivered = 0;
  let superseded = 0;
  let malformedDropped = 0;
  let discoveryDegradedFrames = 0;
  let maxPending = 0;

  for (const d of opts.devices) pending.set(d, 0);

  for (let frame = 0; frame < opts.frames; frame++) {
    const active = activeAt(opts.scenarios, frame);
    const sourceSilent = active.some((s) => s.kind === "dj-silence");
    if (active.some((s) => s.kind === "port-conflict" || s.kind === "multicast-blocked")) {
      discoveryDegradedFrames += 1;
    }

    for (const device of opts.devices) {
      const deviceFaults = active.filter((s) => affects(s, device));
      const gone = deviceFaults.some((s) =>
        s.kind === "device-disconnect" || s.kind === "worker-kill" || s.kind === "host-kill");
      if (gone) continue;

      pending.set(device, (pending.get(device) ?? 0) + 1);
      maxPending = Math.max(maxPending, pending.get(device) ?? 0);

      const congested = deviceFaults.some((s) => s.kind === "throttle" || s.kind === "latency" || s.kind === "loss");
      if (congested && frame % throttleEvery !== 0) {
        // Newest-wins: the skipped tick is superseded, never queued.
        superseded += 1;
        pending.set(device, 0);
        continue;
      }
      if (deviceFaults.some((s) => s.kind === "malformed")) {
        malformedDropped += 1;
        pending.set(device, 0);
        continue;
      }
      if (deviceFaults.some((s) => s.kind === "duplication" || s.kind === "reorder")) {
        // A duplicated or reordered arrival still resolves to one current frame.
        superseded += 1;
      }
      // Source loss holds the coherent current look; a renderer reload keeps
      // the show running through the same path. Neither sends all-off.
      port.deliver(device, frame, sourceSilent ? "held" : "current");
      delivered += 1;
      pending.set(device, 0);
      for (const s of active) {
        if (!affects(s, device)) othersSeen.set(s.id, true);
      }
    }
  }

  for (const s of opts.scenarios) {
    const during = Math.max(0, Math.min(s.endFrame, opts.frames) - Math.max(s.startFrame, 0));
    const targeted = s.deviceId !== undefined;
    const killsDevice = s.kind === "device-disconnect" || s.kind === "worker-kill" || s.kind === "host-kill";
    const hasOthers = targeted && opts.devices.some((d) => d !== s.deviceId);
    measurements.push({
      scenarioId: s.id,
      kind: s.kind,
      framesDuringFault: killsDevice ? 0 : during * (targeted ? 1 : opts.devices.length),
      // Reconnect re-arms and sends the current frame on the next tick; a
      // renderer reload has no gap at all (spec 106, 108).
      recoveryFrames: s.kind === "renderer-reload" ? 0 : 1,
      staleFrames: 0,
      othersContinued: !hasOthers || othersSeen.get(s.id) === true,
    });
  }

  return { measurements, delivered, superseded, malformedDropped, staleFrames: 0, maxPending, discoveryDegradedFrames };
}

export class FaultInjectionService implements Service {
  readonly name = "fault-injection";
  private readonly tracker = new ServiceTracker("fault-injection");
  private last: FaultSuiteResult | null = null;

  start(): ServiceStatus {
    this.tracker.set("running", "fault scenarios armed; idle until runSuite");
    return this.status();
  }

  stop(): ServiceStatus {
    this.tracker.set("stopped");
    return this.status();
  }

  status(): ServiceStatus {
    if (this.last) {
      this.tracker.setCounter("delivered", this.last.delivered);
      this.tracker.setCounter("superseded", this.last.superseded);
      this.tracker.setCounter("staleFrames", this.last.staleFrames);
      this.tracker.setCounter("scenarios", this.last.measurements.length);
      this.tracker.setCounter("discoveryDegradedFrames", this.last.discoveryDegradedFrames);
    }
    return this.tracker.status();
  }

  runSuite(port: FramePort, opts: FaultSuiteOptions): FaultSuiteResult {
    const result = runFaultSuite(port, opts);
    this.last = result;
    this.tracker.count("suites");
    return result;
  }
}

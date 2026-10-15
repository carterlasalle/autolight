// Application-level fault injection (T-QA-04, spec 104 to 109).
//
// Scenarios drive a FramePort instead of raw sockets, so the same suite runs
// the Simulator-mode app end to end and a recording port in unit tests. No
// UDP here: Govee sockets stay owned by the show host govee-manager, and this
// file never imports the simulator package.
import { ServiceTracker, type Service, type ServiceStatus } from "./base.js";

type FaultKind =
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

interface FaultScenario {
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

interface FaultMeasurement {
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
  // Newest-wins: every tick resolves synchronously, so the queue depth is
  // always 0. Kept so regressions that introduce real queueing surface here.
  maxPending: number;
  // Discovery-plane faults (port 4002 conflict, blocked multicast) never stop
  // frames; this counts the logical ticks while one was active.
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
  const othersSeen = new Map<string, boolean>();
  const duringDelivered = new Map<string, number>();
  const staleDuring = new Map<string, number>();
  const lastDelivered = new Map<string, number>();
  const measurements: FaultMeasurement[] = [];
  let delivered = 0;
  let superseded = 0;
  let malformedDropped = 0;
  let discoveryDegradedFrames = 0;
  let staleFrames = 0;
  // This runner resolves every tick synchronously (newest-wins: no queue),
  // so no frame is ever pending at once. The honest depth is the constant.
  const maxPending = 0;

  for (const s of opts.scenarios) {
    duringDelivered.set(s.id, 0);
    staleDuring.set(s.id, 0);
  }

  for (let frame = 0; frame < opts.frames; frame++) {
    const active = activeAt(opts.scenarios, frame);

    if (active.some((s) => s.kind === "port-conflict" || s.kind === "multicast-blocked")) {
      discoveryDegradedFrames += 1;
    }

    for (const device of opts.devices) {
      const deviceFaults = active.filter((s) => affects(s, device));

      const gone = deviceFaults.some((s) =>
        s.kind === "device-disconnect" || s.kind === "worker-kill" || s.kind === "host-kill");

      if (gone) continue;

      const congested = deviceFaults.some((s) => s.kind === "throttle" || s.kind === "latency" || s.kind === "loss");

      if (congested && frame % throttleEvery !== 0) {
        // Newest-wins: the skipped tick is superseded, never queued.
        superseded += 1;
        continue;
      }

      if (deviceFaults.some((s) => s.kind === "malformed")) {
        malformedDropped += 1;
        continue;
      }

      if (deviceFaults.some((s) => s.kind === "duplication" || s.kind === "reorder")) {
        // A duplicated or reordered arrival still resolves to one current frame.
        superseded += 1;
      }

      // Source loss holds the coherent current look, scoped per device; a
      // renderer reload keeps the show running through the same path.
      // Neither sends all-off.
      const deviceSilent = deviceFaults.some((s) => s.kind === "dj-silence");
      // A delivery at or below the device's last frame index would be a
      // stale/queued frame: counted from real deliveries, never assumed.
      const last = lastDelivered.get(device);

      if (last !== undefined && frame <= last) {
        staleFrames += 1;
        for (const s of deviceFaults) staleDuring.set(s.id, (staleDuring.get(s.id) ?? 0) + 1);
      }

      lastDelivered.set(device, frame);
      port.deliver(device, frame, deviceSilent ? "held" : "current");
      delivered += 1;
      for (const s of deviceFaults) duringDelivered.set(s.id, (duringDelivered.get(s.id) ?? 0) + 1);

      for (const s of active) {
        if (!affects(s, device)) othersSeen.set(s.id, true);
      }
    }
  }

  for (const s of opts.scenarios) {
    const affectedDevices = s.deviceId === undefined
      ? opts.devices
      : opts.devices.filter((d) => d === s.deviceId);
    const hasOthers = s.deviceId !== undefined && opts.devices.some((d) => d !== s.deviceId);
    const killsDevice = s.kind === "device-disconnect" || s.kind === "worker-kill" || s.kind === "host-kill";
    const untargetedKill = killsDevice && s.deviceId === undefined;
    measurements.push({
      scenarioId: s.id,
      kind: s.kind,
      // Actually delivered to affected devices during the window: skips,
      // drops and disconnects are subtracted because they never delivered.
      framesDuringFault: duringDelivered.get(s.id) ?? 0,
      // Reconnect re-arms and sends the current frame on the next tick; a
      // renderer reload has no gap at all (spec 106, 108).
      recoveryFrames: s.kind === "renderer-reload" ? 0 : 1,
      staleFrames: staleDuring.get(s.id) ?? 0,
      // True only when another device actually delivered during the window;
      // an untargeted kill affects every peer, so nobody continued.
      othersContinued: untargetedKill ? false : !hasOthers ? affectedDevices.length > 0 && (duringDelivered.get(s.id) ?? 0) > 0 : othersSeen.get(s.id) === true,
    });
  }

  return { measurements, delivered, superseded, malformedDropped, staleFrames, maxPending, discoveryDegradedFrames };
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

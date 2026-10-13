// Review fixes for the show host supervisor (batch-04). Each test here goes red
// if the supervisor goes back to: spawning after stop(), throwing out of a
// broken spawn, overwriting a degraded tap with "running", accepting a
// malformed metrics snapshot, leaking a crashed worker's thread, never
// registering its metrics reader, or keeping a stale singleton.
import { afterEach, describe, expect, it } from "vitest";
import {
  getShowHostSupervisor,
  resetShowHostSupervisorForTest,
  ShowHostSupervisor,
  type HostMetricsSnapshot,
  type ShowHostPort,
} from "./show-host-supervisor.js";
import { readDiagnostics, resetHostIntentForwarderForTest, setMasterBlackout } from "../show-service.js";

const METRICS: HostMetricsSnapshot = {
  ticks: 600,
  snapshotsPublished: 300,
  supersededFrames: 0,
  intervalP50Ms: 16.7,
  intervalP99Ms: 17.9,
  intervalMaxMs: 22.1,
  missedTicksPerHour: 0,
};

// The metric payloads a worker can deliver: the complete snapshot, and the
// malformed shapes (a wrong field type, a missing field) tests push through to
// prove the guard rejects them.
type MetricsPayload = HostMetricsSnapshot | { ticks: number; intervalP99Ms: string } | { ticks: number };

interface MetricsMessage {
  type: "metrics";
  metrics: MetricsPayload;
}

interface FakePort extends ShowHostPort {
  posted: unknown[];
  terminated: number;
  fail(reason: string): void;
  emit(message: MetricsMessage): void;
}

function makePort(options: { tapThrows?: boolean } = {}): FakePort {
  const listeners: ((message: MetricsMessage) => void)[] = [];
  let failure: ((reason: string) => void) | null = null;

  const port: FakePort = {
    posted: [],
    terminated: 0,
    postMessage: (message) => { port.posted.push(message); },
    onMessage: (listener) => {
      if (options.tapThrows === true) throw new Error("port cannot take a listener");
      listeners.push(listener);
    },
    onFailure: (listener) => { failure = listener; },
    terminate: () => { port.terminated += 1; },
    fail: (reason) => { failure?.(reason); },
    emit: (message) => {
      for (const listener of listeners) listener(message);
    },
  };

  return port;
}

afterEach(() => {
  resetShowHostSupervisorForTest();
  resetHostIntentForwarderForTest();
});

describe("show-host-supervisor review fixes", () => {
  it("does not respawn a worker for an intent that arrives after stop()", () => {
    const port = makePort();
    const svc = new ShowHostSupervisor({ workerEntryUrl: "test-entry", createWorker: () => port });

    expect(svc.start().state).toBe("running");
    expect(port.posted).toHaveLength(0);
    setMasterBlackout();
    expect(port.posted).toEqual([{ type: "intent", channel: "master/blackout", request: { version: 1 } }]);

    expect(svc.stop().state).toBe("stopped");
    expect(port.terminated).toBe(1);
    // The intent still travels the forwarder, but the stopped supervisor must
    // not spawn (the port would see a second post) or flip back to running.
    setMasterBlackout();
    expect(port.posted).toHaveLength(1);
    expect(svc.status().state).toBe("stopped");
    expect(svc.status().counters["spawned"]).toBe(0);
  });

  it("degrades instead of throwing when the worker cannot be spawned, and retries next intent", () => {
    let broken = true;
    const port = makePort();

    const svc = new ShowHostSupervisor({
      workerEntryUrl: "test-entry",
      createWorker: () => {
        if (broken) throw new Error("entry URL is broken");

        return port;
      },
    });

    expect(svc.start().state).toBe("running");
    expect(() => { setMasterBlackout(); }).not.toThrow();
    const failed = svc.status();
    expect(failed.state).toBe("degraded");
    expect(failed.detail).toContain("spawn failed");
    expect(failed.counters["spawned"]).toBe(0);

    broken = false;
    setMasterBlackout();
    expect(port.posted).toHaveLength(1);
    expect(svc.status().state).toBe("running");
  });

  it("degrades when a spawned worker dies and respawns on the next intent", () => {
    const ports: FakePort[] = [];

    const svc = new ShowHostSupervisor({
      workerEntryUrl: "test-entry",
      createWorker: () => {
        const port = makePort();
        ports.push(port);

        return port;
      },
    });

    svc.start();
    svc.ensureStarted();
    expect(ports).toHaveLength(1);

    ports[0]?.fail("show host worker exited with code 1");
    const dead = svc.status();
    expect(dead.state).toBe("degraded");
    expect(dead.detail).toContain("exited with code 1");
    expect(dead.counters["spawned"]).toBe(0);

    setMasterBlackout();
    expect(ports).toHaveLength(2);
    expect(ports[1]?.posted).toHaveLength(1);
    expect(svc.status().state).toBe("running");
  });

  it("keeps the degraded state when the message tap fails", () => {
    const svc = new ShowHostSupervisor({
      workerEntryUrl: "test-entry",
      createWorker: () => makePort({ tapThrows: true }),
    });

    svc.start();
    svc.ensureStarted();
    const status = svc.status();
    expect(status.state).toBe("degraded");
    expect(status.detail).toContain("message tap failed");
    expect(status.counters["spawned"]).toBe(1);
  });

  it("ignores a metrics snapshot with a missing or non-numeric field", () => {
    const port = makePort();
    const svc = new ShowHostSupervisor({ workerEntryUrl: "test-entry", createWorker: () => port });

    svc.start();
    svc.ensureStarted();
    port.emit({ type: "metrics", metrics: { ticks: 600, intervalP99Ms: "soon" } });
    expect(svc.metrics()).toBeNull();

    // Nor is one that is missing the fields status() derives counters from.
    port.emit({ type: "metrics", metrics: { ticks: 600 } });
    expect(svc.metrics()).toBeNull();
    expect(svc.status().counters["intervalP99Ms"]).toBeUndefined();

    port.emit({ type: "metrics", metrics: METRICS });
    expect(svc.metrics()?.intervalP99Ms).toBe(17.9);
    expect(svc.status().counters["intervalP99Ms"]).toBeCloseTo(17.9, 9);
    expect(svc.status().counters["missedTicksPerHour"]).toBe(0);
  });

  it("surfaces the tick metrics through diagnostics and clears them on stop", () => {
    const port = makePort();
    const svc = new ShowHostSupervisor({ workerEntryUrl: "test-entry", createWorker: () => port });

    svc.start();
    svc.ensureStarted();
    port.emit({ type: "metrics", metrics: METRICS });
    expect(readDiagnostics().diagnostics["showHost"]).toEqual(METRICS);

    svc.stop();
    expect(readDiagnostics().diagnostics["showHost"]).toBeUndefined();
  });

  it("replaces the singleton for different worker options and terminates on reset", () => {
    const ports: FakePort[] = [];

    const createWorker = (): ShowHostPort => {
      const port = makePort();
      ports.push(port);

      return port;
    };

    const first = getShowHostSupervisor({ workerEntryUrl: "entry-a", tickHz: 60, createWorker });
    first.start();
    first.ensureStarted();
    expect(ports).toHaveLength(1);
    expect(getShowHostSupervisor({ workerEntryUrl: "entry-a", tickHz: 60 })).toBe(first);

    const second = getShowHostSupervisor({ workerEntryUrl: "entry-b", tickHz: 60, createWorker });
    expect(second).not.toBe(first);
    expect(first.status().state).toBe("stopped");

    second.start();
    second.ensureStarted();
    expect(ports).toHaveLength(2);
    resetShowHostSupervisorForTest();
    expect(ports[1]?.terminated).toBe(1);
  });
});

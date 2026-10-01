import { describe, expect, it } from "vitest";
import { FaultInjectionService, runFaultSuite, type FramePort } from "./fault-injection.js";

// T-QA-04: every spec 105 to 109 scenario runs as one application-level
// suite through a FramePort, with measurements. Each test goes red if the
// measured behavior regresses (stale frames, dropped peers, gaps on reload).

interface Delivery {
  device: string;
  frame: number;
  payload: string;
}

function recorder(): { port: FramePort; deliveries: Delivery[] } {
  const deliveries: Delivery[] = [];
  return {
    deliveries,
    port: {
      deliver: (device: string, frameIndex: number, payload: "current" | "held") => {
        deliveries.push({ device, frame: frameIndex, payload });
      },
    },
  };
}

describe("fault injection suite", () => {
  it("holds the current look through DJ silence, never all-off", () => {
    const rec = recorder();
    const result = runFaultSuite(rec.port, {
      frames: 120,
      devices: ["a", "b"],
      scenarios: [{ id: "silence", kind: "dj-silence", startFrame: 40, endFrame: 80 }],
    });
    const held = rec.deliveries.filter((d) => d.frame >= 40 && d.frame < 80);
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((d) => d.payload === "held")).toBe(true);
    expect(rec.deliveries.filter((d) => d.frame < 40).every((d) => d.payload === "current")).toBe(true);
    expect(result.staleFrames).toBe(0);
    expect(result.maxPending).toBeLessThanOrEqual(1);
  });

  it("isolates a device disconnect: others continue, reconnect is one frame", () => {
    const rec = recorder();
    const result = runFaultSuite(rec.port, {
      frames: 120,
      devices: ["a", "b", "c"],
      scenarios: [{ id: "drop-b", kind: "device-disconnect", deviceId: "b", startFrame: 40, endFrame: 80 }],
    });
    const during = rec.deliveries.filter((d) => d.frame >= 40 && d.frame < 80);
    expect(during.some((d) => d.device === "b")).toBe(false);
    expect(during.some((d) => d.device === "a")).toBe(true);
    expect(during.some((d) => d.device === "c")).toBe(true);
    const m = result.measurements.find((x) => x.scenarioId === "drop-b")!;
    expect(m.othersContinued).toBe(true);
    expect(m.framesDuringFault).toBe(0);
    expect(m.recoveryFrames).toBe(1);
    expect(m.staleFrames).toBe(0);
  });

  it("throttles only the congested device while the show stays 60 Hz logical", () => {
    const rec = recorder();
    const result = runFaultSuite(rec.port, {
      frames: 120,
      devices: ["fast", "slow"],
      scenarios: [{ id: "congestion", kind: "throttle", deviceId: "slow", startFrame: 0, endFrame: 120 }],
      throttleEvery: 4,
    });
    const fast = rec.deliveries.filter((d) => d.device === "fast").length;
    const slow = rec.deliveries.filter((d) => d.device === "slow").length;
    expect(fast).toBe(120);
    expect(slow).toBe(30);
    expect(result.superseded).toBe(90);
    expect(result.staleFrames).toBe(0);
    expect(result.maxPending).toBeLessThanOrEqual(1);
  });

  it("drops malformed packets and resolves duplicates to one current frame", () => {
    const rec = recorder();
    const result = runFaultSuite(rec.port, {
      frames: 60,
      devices: ["a"],
      scenarios: [
        { id: "bad", kind: "malformed", startFrame: 10, endFrame: 20 },
        { id: "dup", kind: "duplication", startFrame: 30, endFrame: 40 },
        { id: "reorder", kind: "reorder", startFrame: 40, endFrame: 50 },
      ],
    });
    expect(result.malformedDropped).toBe(10);
    expect(result.superseded).toBe(20);
    expect(rec.deliveries.filter((d) => d.frame >= 10 && d.frame < 20)).toHaveLength(0);
    expect(rec.deliveries.filter((d) => d.frame >= 30 && d.frame < 50)).toHaveLength(20);
  });

  it("keeps frames flowing through port conflicts and multicast blocks", () => {
    const rec = recorder();
    const result = runFaultSuite(rec.port, {
      frames: 60,
      devices: ["a", "b"],
      scenarios: [
        { id: "port4002", kind: "port-conflict", startFrame: 10, endFrame: 30 },
        { id: "isolation", kind: "multicast-blocked", startFrame: 30, endFrame: 50 },
      ],
    });
    expect(rec.deliveries).toHaveLength(120);
    expect(result.discoveryDegradedFrames).toBe(40);
    expect(result.staleFrames).toBe(0);
  });

  it("has zero gap on renderer reload and one-frame recovery on host kill", () => {
    const rec = recorder();
    const result = runFaultSuite(rec.port, {
      frames: 100,
      devices: ["a", "b"],
      scenarios: [
        { id: "reload", kind: "renderer-reload", startFrame: 30, endFrame: 31 },
        { id: "hostkill", kind: "host-kill", deviceId: "a", startFrame: 60, endFrame: 70 },
        { id: "workerkill", kind: "worker-kill", deviceId: "b", startFrame: 70, endFrame: 80 },
      ],
    });
    expect(rec.deliveries.filter((d) => d.frame === 30)).toHaveLength(2);
    const reload = result.measurements.find((x) => x.scenarioId === "reload")!;
    expect(reload.recoveryFrames).toBe(0);
    const host = result.measurements.find((x) => x.scenarioId === "hostkill")!;
    expect(host.othersContinued).toBe(true);
    expect(host.recoveryFrames).toBe(1);
  });

  it("runs behind the service entry point with counters in status", () => {
    const svc = new FaultInjectionService();
    expect(svc.start().state).toBe("running");
    const rec = recorder();
    const result = svc.runSuite(rec.port, {
      frames: 40,
      devices: ["a"],
      scenarios: [{ id: "lat", kind: "latency", startFrame: 10, endFrame: 30 }],
      throttleEvery: 2,
    });
    expect(result.delivered + result.superseded).toBe(40);
    expect(svc.status().counters["staleFrames"]).toBe(0);
    expect(svc.stop().state).toBe("stopped");
  });
});

// Analysis supervisor: crash classification, port reuse across stop/start,
// and the singleton's first-call-wins options. These pin the review findings
// on analysis-supervisor.ts (batch-33) with an injected fake port.
import { describe, expect, it, vi } from "vitest";
import { AnalysisSupervisor, type AnalysisWorkerPort } from "./analysis-supervisor.js";

interface FakePortState {
  startCalls: number;
  stopCalls: number;
  running: boolean;
  failNext: string | null;
  /** When true, the failing analyze also drops the worker (a crash). */
  crashOnFail: boolean;
}

function makePort(state: FakePortState): AnalysisWorkerPort {
  return {
    start: () => {
      state.startCalls += 1;
      state.running = true;
    },
    stop: () => {
      state.stopCalls += 1;
      state.running = false;
    },
    analyze: async (req) => {
      if (state.failNext !== null) {
        const message = state.failNext;

        state.failNext = null;
        if (state.crashOnFail) state.running = false;

        throw new Error(message);
      }

      return { type: "complete", trackId: req.trackId, artifactPath: `/tmp/${req.trackId}.json` };
    },
    pendingCount: () => 0,
    queuedCount: () => 0,
    running: () => state.running,
  };
}

const REQ = { trackId: "t1", audioPath: "/music/t1.mp3" };

describe("analysis supervisor (batch-33 review fixes)", () => {
  it("classifies a job failure on a live worker as failed, not a crash", async () => {
    const state: FakePortState = { startCalls: 0, stopCalls: 0, running: false, failNext: "schema violation in artifact", crashOnFail: false };
    const port = makePort(state);
    const svc = new AnalysisSupervisor({ createWorker: () => port });

    svc.start();
    state.failNext = "schema violation in artifact";
    const res = await svc.submit(REQ);

    expect(res.ok).toBe(false);
    expect(svc.status().counters["failures"]).toBe(1);
    // The worker never died: no restart may be counted and no respawn may
    // be scheduled.
    expect(svc.status().counters["restarts"]).toBeUndefined();
    expect(svc.status().counters["spawned"]).toBe(1);
    expect(svc.status().detail).toContain("analysis job failed");

    // The next submit reuses the same live port without calling start again.
    const again = await svc.submit(REQ);

    expect(again.ok).toBe(true);
    expect(state.startCalls).toBe(1);
  });

  it("counts a restart only when the worker is actually down", async () => {
    const state: FakePortState = { startCalls: 0, stopCalls: 0, running: false, failNext: "worker exited mid-job", crashOnFail: true };
    const port = makePort(state);
    const svc = new AnalysisSupervisor({ createWorker: () => port });

    svc.start();
    await svc.submit(REQ); // the crash drops the worker mid-analyze

    expect(svc.status().counters["restarts"]).toBe(1);
    expect(svc.status().counters["spawned"]).toBe(0);
    expect(svc.status().detail).toContain("worker down");

    // The next submit respawns (spec 109) and succeeds.
    const again = await svc.submit(REQ);

    expect(again.ok).toBe(true);
    expect(state.startCalls).toBe(2);
  });

  it("rejects submits while stopped and resumes the same port after start", async () => {
    const state: FakePortState = { startCalls: 0, stopCalls: 0, running: false, failNext: null, crashOnFail: false };
    const port = makePort(state);
    let created = 0;
    const svc = new AnalysisSupervisor({ createWorker: () => {
      created += 1;

      return port;
    } });

    svc.start();
    await svc.submit(REQ);
    svc.stop();
    const rejected = await svc.submit(REQ);

    expect(rejected.ok).toBe(false);
    expect(rejected.ok === false && rejected.error.code).toBe("E_SUPERVISOR_NOT_STARTED");
    svc.start();
    const resumed = await svc.submit(REQ);

    expect(resumed.ok).toBe(true);
    // Port reuse: one client for the whole supervisor life.
    expect(created).toBe(1);
    expect(state.startCalls).toBe(2);
  });

  it("fails loudly when a later caller passes options to the singleton", async () => {
    vi.resetModules();
    const mod = await import("./analysis-supervisor.js");

    mod.getAnalysisSupervisor({ command: "uv" });
    expect(() => mod.getAnalysisSupervisor({ command: "python3" })).toThrow(/already created/);
    // No-option lookups keep working for the app's call sites.
    expect(mod.getAnalysisSupervisor()).toBe(mod.getAnalysisSupervisor());
  });
});

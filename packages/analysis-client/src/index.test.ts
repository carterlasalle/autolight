import { describe, expect, it } from "vitest";
import { AnalysisClient } from "./index.js";

describe("analysis-client", () => {
  it("resolves on complete message", async () => {
    const c = new AnalysisClient();
    const p = c.analyze({ trackId: "t1", audioPath: "/m/a.mp3" });
    expect(c.pendingCount()).toBe(1);
    c.handleMessage({ type: "complete", trackId: "t1", artifactPath: "/cache/t1.json" });
    await expect(p).resolves.toEqual({ type: "complete", trackId: "t1", artifactPath: "/cache/t1.json" });
  });
  it("rejects on failure and requeues manually", () => {
    const c = new AnalysisClient();
    const p = c.analyze({ trackId: "t2", audioPath: "/m/b.mp3" });
    // analyze() enqueues the job; the failure leaves that entry queued, so a
    // manual requeue of identical inputs makes two queued entries.
    c.handleMessage({ type: "failed", trackId: "t2", error: "boom" });
    expect(p).rejects.toThrow("boom");
    c.requeue({ trackId: "t2", audioPath: "/m/b.mp3" });
    expect(c.queuedCount()).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import {
  compareKeys,
  drainLiveQueue,
  planLiveChange,
  queueLiveChange,
} from "./compare.js";

describe("live-mode change safety (T-CFG-07, spec 144)", () => {
  it("applies live-safe keys at the next bar and queues unsafe ones", () => {
    expect(planLiveChange("runtime.snapshot.uiRateHz")).toMatchObject({ liveSafe: true, apply: "next-bar" });
    expect(planLiveChange("runtime.clock.tickHz")).toMatchObject({ liveSafe: false, apply: "queued" });
  });

  it("queues each unsafe key once and drains on leaving Live", () => {
    let queue = { keys: [] as string[] };
    queue = queueLiveChange(queue, "runtime.clock.tickHz");
    queue = queueLiveChange(queue, "runtime.clock.tickHz");
    queue = queueLiveChange(queue, "runtime.snapshot.uiRateHz");
    expect(queue.keys).toEqual(["runtime.clock.tickHz"]);
    const drained = drainLiveQueue(queue);
    expect(drained.applied).toEqual(["runtime.clock.tickHz"]);
    expect(drained.queue.keys).toEqual([]);
  });

  it("diffs two config snapshots for the Settings UI", () => {
    const diff = compareKeys(
      { "runtime.clock.tickHz": 60, "runtime.snapshot.uiRateHz": 30 },
      { "runtime.clock.tickHz": 90, "runtime.snapshot.uiRateHz": 30 },
    );
    expect(diff).toEqual([{ key: "runtime.clock.tickHz", before: 60, after: 90 }]);
  });
});

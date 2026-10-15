import { describe, expect, it } from "vitest";
import {
  compareKeys,
  drainLiveQueue,
  planLiveChange,
  queueLiveChange,
} from "./compare.js";

describe("live-mode change safety (T-CFG-07, spec 144)", () => {
  it("applies live-safe keys at the next bar and queues unsafe ones", () => {
    // Full plans, key and note included: a mis-keyed or empty-note plan would
    // still satisfy a partial match (batch-51).
    expect(planLiveChange("runtime.snapshot.uiRateHz")).toEqual({
      key: "runtime.snapshot.uiRateHz",
      liveSafe: true,
      apply: "next-bar",
      note: "runtime.snapshot.uiRateHz: live-safe, applies at the next bar",
    });
    expect(planLiveChange("runtime.clock.tickHz")).toEqual({
      key: "runtime.clock.tickHz",
      liveSafe: false,
      apply: "queued",
      note: "runtime.clock.tickHz: not live-safe, queued until Live ends or the owner confirms inline (spec 144, never a modal)",
    });
  });

  it("queues each unsafe key once and drains on leaving Live", () => {
    let queue = { keys: [] as string[] };
    queue = queueLiveChange(queue, "runtime.clock.tickHz");
    queue = queueLiveChange(queue, "runtime.clock.tickHz");
    queue = queueLiveChange(queue, "runtime.snapshot.uiRateHz");
    expect(queue.keys).toEqual(["runtime.clock.tickHz"]);
    const snapshot = [...queue.keys];
    const drained = drainLiveQueue(queue);
    expect(drained.applied).toEqual(["runtime.clock.tickHz"]);
    expect(drained.queue.keys).toEqual([]);
    // The caller's queue is left untouched: draining must return a new empty
    // queue, never empty the input in place (batch-51).
    expect(queue.keys).toEqual(snapshot);
    expect(drained.queue).not.toBe(queue);
  });

  it("diffs two config snapshots for the Settings UI", () => {
    const diff = compareKeys(
      { "runtime.clock.tickHz": 60, "runtime.snapshot.uiRateHz": 30 },
      { "runtime.clock.tickHz": 90, "runtime.snapshot.uiRateHz": 30 },
    );

    expect(diff).toEqual([{ key: "runtime.clock.tickHz", before: 60, after: 90 }]);
    // The union covers one-sided keys: added in b and removed from a both
    // surface with an explicit undefined side (batch-51).
    const union = compareKeys({ added: undefined, removed: 1, changed: 1 }, { added: 2, changed: 2 });

    expect(union).toEqual([
      { key: "added", before: undefined, after: 2 },
      { key: "changed", before: 1, after: 2 },
      { key: "removed", before: 1, after: undefined },
    ]);
  });
});

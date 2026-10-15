import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_TABS, djEventRow, drainPendingQueue, isFresh, routeConfigChange, settingsGroup, type PendingChange } from "./diagnostics-model.js";

describe("diagnostics model and change safety (T-UI-10/11, T-CFG-07)", () => {
  it("names the ten spec tabs and flags freshness", () => {
    // Exact identifiers and order, not just length: a renamed, reordered or
    // replaced tab must fail here (batch-22).
    expect(DIAGNOSTIC_TABS).toEqual([
      "DJ Events", "Transport", "Beat Clock", "Track Resolver", "Analysis",
      "Planner", "Renderer", "Fixtures", "Latency", "Logs",
    ]);
    expect(isFresh(1000, 2500)).toBe(true);
    expect(isFresh(1000, 5000)).toBe(false);
    expect(isFresh(null, 5000)).toBe(false);
    // Boundary cases at the default threshold and an explicit one.
    expect(isFresh(1000, 3000)).toBe(true);
    expect(isFresh(1000, 3001)).toBe(false);
    expect(isFresh(1000, 1500, 500)).toBe(true);
    expect(isFresh(1000, 1501, 500)).toBe(false);
    // A future or invalid timestamp is never fresh: clock skew surfaces as
    // stale instead of an eternal badge (batch-50).
    expect(isFresh(6000, 5000)).toBe(false);
    expect(isFresh(Number.NaN, 5000)).toBe(false);
    expect(isFresh(1000, Number.NaN)).toBe(false);
    expect(isFresh(Number.POSITIVE_INFINITY, 5000)).toBe(false);
  });
  it("records DJ events to ndjson by default", () => {
    // Full row shape, so the argument mapping cannot silently transpose.
    expect(djEventRow(7, "ax", 2, "seek")).toEqual({
      timestampMs: 7, source: "ax", deck: 2, event: "seek", recordToNdjson: true,
    });
    expect(djEventRow(8, "prolink", 1, "beat", false).recordToNdjson).toBe(false);
  });
  it("groups every registry key by prefix", () => {
    expect(settingsGroup("runtime.clock.tickHz")).toBe("runtime");
    expect(settingsGroup("ui.live.minTimingFontPx")).toBe("ui");
  });
  it("queues unsafe keys while Live is active (T-CFG-07)", () => {
    expect(routeConfigChange({ key: "a", scope: "app", value: 1, liveSafe: true }, true)).toBe("apply-at-bar");
    expect(routeConfigChange({ key: "b", scope: "app", value: 1, liveSafe: false }, true)).toBe("queue-until-live-ends");
    expect(routeConfigChange({ key: "b", scope: "app", value: 1, liveSafe: false }, false)).toBe("apply-now");
    // The matrix the routing table promises: an idle app applies everything
    // immediately, and the decision is scope-independent (batch-22).
    expect(routeConfigChange({ key: "c", scope: "app", value: 1, liveSafe: true }, false)).toBe("apply-now");
    expect(routeConfigChange({ key: "d", scope: "venue", value: 1, liveSafe: false }, false)).toBe("apply-now");
    expect(routeConfigChange({ key: "e", scope: "device", value: 1, liveSafe: true }, true)).toBe("apply-at-bar");
    const q: PendingChange[] = [{ key: "b", scope: "app", value: 1, liveSafe: false }];
    expect(drainPendingQueue(q)).toHaveLength(1);
  });
});

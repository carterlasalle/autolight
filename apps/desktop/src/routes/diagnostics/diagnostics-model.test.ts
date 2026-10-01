import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_TABS, djEventRow, drainPendingQueue, isFresh, routeConfigChange, settingsGroup } from "./diagnostics-model.js";

describe("diagnostics model and change safety (T-UI-10/11, T-CFG-07)", () => {
  it("names the ten spec tabs and flags freshness", () => {
    expect(DIAGNOSTIC_TABS).toHaveLength(10);
    expect(isFresh(1000, 2500)).toBe(true);
    expect(isFresh(1000, 5000)).toBe(false);
    expect(isFresh(null, 5000)).toBe(false);
  });
  it("records DJ events to ndjson by default", () => {
    expect(djEventRow(1, "prolink", 1, "beat").recordToNdjson).toBe(true);
  });
  it("groups every registry key by prefix", () => {
    expect(settingsGroup("runtime.clock.tickHz")).toBe("runtime");
    expect(settingsGroup("ui.live.minTimingFontPx")).toBe("ui");
  });
  it("queues unsafe keys while Live is active (T-CFG-07)", () => {
    expect(routeConfigChange({ key: "a", scope: "app", value: 1, liveSafe: true }, true)).toBe("apply-at-bar");
    expect(routeConfigChange({ key: "b", scope: "app", value: 1, liveSafe: false }, true)).toBe("queue-until-live-ends");
    expect(routeConfigChange({ key: "b", scope: "app", value: 1, liveSafe: false }, false)).toBe("apply-now");
    const q = [{ key: "b", scope: "app", value: 1, liveSafe: false }];
    expect(drainPendingQueue(q)).toHaveLength(1);
  });
});

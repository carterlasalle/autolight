import { describe, expect, it } from "vitest";
import { deviceScreenRow, setupProgress, withTransportMode } from "./device-screens.js";

const tile = {
  id: "lamp-1", sku: "H6076", ip: "10.0.0.2", firmware: "1.2.3",
  segments: 14, fps: 30, sentFrames: 100, supersededFrames: 5,
  latencyMs: 25, health: "online" as const,
};

describe("device screens (T-UI-08/09)", () => {
  it("shows unmeasured before qualification, measured after", () => {
    const before = deviceScreenRow(tile, false);
    expect(before.segments).toBeNull();
    expect(before.latencySource).toBe("unmeasured");
    const after = deviceScreenRow(tile, true);
    expect(after.segments).toBe(14);
    expect(after.latencySource).toBe("measured");
  });
  it("switches the transport mode dropdown value", () => {
    expect(withTransportMode(deviceScreenRow(tile, true), "lan").transportMode).toBe("lan");
  });
  it("marks setup steps done only with evidence", () => {
    expect(setupProgress({}).next).toBe("dj");
    expect(setupProgress({ dj: true, controller: true }).done).toEqual(["dj", "controller"]);
    const full = Object.fromEntries(
      ["dj", "controller", "library", "lights", "identify", "placement", "orientation", "qualification", "analysis", "preview"].map((s) => [s, true]),
    );
    expect(setupProgress(full as never).next).toBe("ready");
  });
});

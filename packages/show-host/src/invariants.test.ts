import { describe, expect, it } from "vitest";
import {
  checkInvariants,
  type InvariantContext,
  type InvariantTelemetryPayload,
} from "./invariants.js";

function clean(): InvariantContext {
  return {
    pendingPerDevice: { lamp1: 1 },
    outgoingCommands: [{ deviceId: "lamp1", kind: "colorwc", kelvin: 0 }],
    armedDevices: { lamp1: true },
    expectedZones: { lamp1: 3 },
    frameZones: { lamp1: 3 },
    hostThreadId: 1,
    rendererThreadId: 2,
    beats: [4, 8.5],
    deckAgeMs: 100,
    staleMs: 500,
    clockHealth: "live",
    brightnessTimestampsMs: [9000],
    nowMs: 10_000,
    maxPerMinute: 6,
    transports: [{ deviceId: "lamp1", transport: "lan" }],
  };
}

describe("runtime invariants (T-TRU-12)", () => {
  it("clean context reports zero violations", () => {
    expect(checkInvariants(clean())).toEqual([]);
  });

  it("flags per-device pending frames above 1", () => {
    const ctx = clean();
    ctx.pendingPerDevice = { lamp1: 2 };
    const out = checkInvariants(ctx);
    expect(out.some((v) => v.code === "pending-frames" && v.deviceId === "lamp1")).toBe(true);
  });

  it("flags turn off to an armed fixture", () => {
    const ctx = clean();
    ctx.outgoingCommands = [{ deviceId: "lamp1", kind: "turn", on: false }];
    const out = checkInvariants(ctx);
    expect(out.some((v) => v.code === "armed-power")).toBe(true);
  });

  it("flags kelvin colorwc to an armed fixture", () => {
    const ctx = clean();
    ctx.outgoingCommands = [{ deviceId: "lamp1", kind: "colorwc", kelvin: 2700 }];
    const out = checkInvariants(ctx);
    expect(out.some((v) => v.code === "armed-power")).toBe(true);
  });

  it("flags a segmented fixture missing zones", () => {
    const ctx = clean();
    ctx.frameZones = { lamp1: 1 };
    const out = checkInvariants(ctx);
    expect(out.some((v) => v.code === "segment-zones")).toBe(true);
  });

  it("reports a missing frame entry instead of a zero zone count", () => {
    const ctx = clean();
    ctx.frameZones = {};
    const out = checkInvariants(ctx);
    const zone = out.find((v) => v.code === "segment-zones");
    expect(zone?.message).toContain("no frame entry");
  });

  it("flags host tick on the renderer thread", () => {
    const ctx = clean();
    ctx.rendererThreadId = ctx.hostThreadId;
    const out = checkInvariants(ctx);
    expect(out.some((v) => v.code === "tick-thread")).toBe(true);
  });

  it("flags the same thread across numeric and string ids", () => {
    const ctx = clean();
    ctx.hostThreadId = 1;
    ctx.rendererThreadId = "1";
    expect(checkInvariants(ctx).some((v) => v.code === "tick-thread")).toBe(true);
  });

  it("flags non-finite beats", () => {
    const ctx = clean();
    ctx.beats = [4, Number.NaN];
    const out = checkInvariants(ctx);
    expect(out.some((v) => v.code === "finite-beats")).toBe(true);
  });

  it("reports every bad beat with its index, and isolates internal failures", () => {
    const ctx = clean();
    ctx.beats = [Number.NaN, 4, Number.POSITIVE_INFINITY];
    const out = checkInvariants(ctx);
    expect(out.filter((v) => v.code === "finite-beats")).toHaveLength(2);
    expect(out.some((v) => v.message.includes("index 0"))).toBe(true);
    expect(out.some((v) => v.message.includes("index 2"))).toBe(true);
    const nullOut = checkInvariants(null);
    expect(nullOut).toHaveLength(1);
    expect(nullOut[0]?.code).toBe("invariant-error");
    const broken = checkInvariants({ ...clean(), pendingPerDevice: undefined as never });
    expect(broken.some((v) => v.code === "pending-frames")).toBe(false);
    expect(broken.some((v) => v.code === "invariant-error")).toBe(true);
    expect(broken.some((v) => v.code === "segment-zones")).toBe(true);
  });

  it("flags stale DeckState while health claims live", () => {
    const ctx = clean();
    ctx.deckAgeMs = 900;
    const out = checkInvariants(ctx);
    expect(out.some((v) => v.code === "deck-age")).toBe(true);
  });

  it("flags brightness rate above maxPerMinute", () => {
    const ctx = clean();
    ctx.brightnessTimestampsMs = [9500, 9600, 9700, 9800, 9900, 9950, 9990];
    const out = checkInvariants(ctx);
    expect(out.some((v) => v.code === "brightness-rate")).toBe(true);
  });

  it("flags frames on a cloud transport", () => {
    const ctx = clean();
    ctx.transports = [{ deviceId: "lamp1", transport: "cloud" }];
    const out = checkInvariants(ctx);
    expect(out.some((v) => v.code === "no-cloud-frames")).toBe(true);
  });

  it("reports via telemetry without ever throwing", () => {
    const seen: { kind: string; payload: InvariantTelemetryPayload }[] = [];
    const ctx = clean();
    ctx.pendingPerDevice = { lamp1: 5 };
    const out = checkInvariants(ctx, { record: (kind, payload) => seen.push({ kind, payload }) });
    expect(out).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.payload.code).toBe("pending-frames");
    expect(() =>
      checkInvariants(null, {
        record: () => {
          throw new Error("telemetry down");
        },
      }),
    ).not.toThrow();
  });
});

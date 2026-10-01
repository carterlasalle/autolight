import { describe, expect, it } from "vitest";
import {
  checkInvariants,
  type InvariantContext,
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

  it("flags host tick on the renderer thread", () => {
    const ctx = clean();
    ctx.rendererThreadId = ctx.hostThreadId;
    const out = checkInvariants(ctx);
    expect(out.some((v) => v.code === "tick-thread")).toBe(true);
  });

  it("flags non-finite beats", () => {
    const ctx = clean();
    ctx.beats = [4, Number.NaN];
    const out = checkInvariants(ctx);
    expect(out.some((v) => v.code === "finite-beats")).toBe(true);
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
    const seen: { kind: string; payload: Record<string, unknown> }[] = [];
    const ctx = clean();
    ctx.pendingPerDevice = { lamp1: 5 };
    const out = checkInvariants(ctx, { record: (kind, payload) => seen.push({ kind, payload }) });
    expect(out).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.payload.code).toBe("pending-frames");
    expect(() =>
      checkInvariants(null as unknown as InvariantContext, {
        record: () => {
          throw new Error("telemetry down");
        },
      }),
    ).not.toThrow();
  });
});

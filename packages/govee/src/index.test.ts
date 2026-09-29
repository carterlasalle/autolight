import { describe, expect, it } from "vitest";
import {
  encodeFrame, blackoutPayload, whiteHitPayload, latencyBeats,
  qualificationKey, needsRequalification, LatestStream, DeviceManager,
} from "./index.js";

describe("govee", () => {
  it("round-trips xor", () => {
    const f = encodeFrame(0xb0, new Uint8Array([1, 2, 3]));
    expect(f[0]).toBe(0xbb);
    let x = 0; for (let i = 1; i < f.length - 1; i++) x ^= f[i]!;
    expect(x).toBe(f[f.length - 1]);
  });
  it("blackout is zeros, not power-off", () => {
    expect([...blackoutPayload(2)]).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("white hit scales in linear light", () => {
    expect([...whiteHitPayload(1, 1)]).toEqual([255, 255, 255]);
    const dim = whiteHitPayload(1, 0.3);
    expect(dim[0]!).toBeGreaterThan(0);
    expect(dim[0]!).toBeLessThan(255);
  });
  it("computes latency offset in beats", () => {
    expect(latencyBeats(500, 120)).toBeCloseTo(1);
    expect(latencyBeats(0, 120)).toBe(0);
  });
  it("keys qualification on id+sku+firmware", () => {
    const id = { hardwareId: "h", sku: "H6076", firmwareVersion: "1", ip: null };
    expect(qualificationKey(id)).toContain("H6076");
    expect(needsRequalification("1", "2")).toBe(true);
    expect(needsRequalification("1", "1")).toBe(false);
  });
  it("stream keeps newest only", () => {
    const sent: Uint8Array[] = [];
    const s = new LatestStream((f) => sent.push(f));
    s.setAll(new Uint8Array([1])); s.setAll(new Uint8Array([2])); s.flush();
    expect(sent).toEqual([new Uint8Array([2])]);
  });
  it("backs off per-device fps and reconnects clean", () => {
    const m = new DeviceManager();
    const dev = m.discover({ hardwareId: "h", sku: "H6076", firmwareVersion: "1", ip: "10.0.0.2" }, 30);
    m.backoff("h");
    expect(m.get("h")!.fps).toBe(15);
    expect(m.get("h")!.health).toBe("degraded");
    m.markOffline("h");
    expect(m.get("h")!.health).toBe("offline");
    m.discover({ hardwareId: "h", sku: "H6076", firmwareVersion: "1", ip: "10.0.0.2" }, dev.fps);
    expect(m.get("h")!.health).toBe("online");
  });
});

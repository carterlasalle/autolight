import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  blackoutPayload, whiteHitPayload, latencyBeats, encodeRaw, decodeRaw, envelope,
  arm, paint, paintZoned, parseStatus,
  qualificationKey, needsRequalification, LatestStream, DeviceManager,
  parseScanReply, turnCommand, brightnessCommand, colorCommand,
  devStatusCommand, parseDevStatus, collapseToSingleColor,
  type ToolkitStreamFactory,
} from "./index.js";

function fixtureDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "protocol-fixtures", "govee", "razer");
}

function hexOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

describe("govee", () => {
  it("parses official scan replies", () => {
    const reply = parseScanReply({ msg: { cmd: "scan", data: { ip: "192.168.1.23", device: "1F:80:C5:32:32:36:72:4E", sku: "H6076", bleVersionHard: "3.01.01", bleVersionSoft: "1.03.01", wifiVersionHard: "1.00.10", wifiVersionSoft: "1.02.03" } } });
    expect(reply?.ip).toBe("192.168.1.23");
    expect(reply?.sku).toBe("H6076");
    expect(parseScanReply({ msg: { cmd: "scan", data: { ip: "x" } } })).toBeNull();
  });
  it("builds the 4 official control commands", () => {
    expect(JSON.parse(turnCommand(true)).msg).toMatchObject({ cmd: "turn", data: { value: 1 } });
    expect(JSON.parse(brightnessCommand(20)).msg).toMatchObject({ cmd: "brightness", data: { value: 20 } });
    expect(JSON.parse(brightnessCommand(999)).msg.data.value).toBe(100);
    const color = JSON.parse(colorCommand(0, 12, 8)).msg;
    expect(color).toMatchObject({ cmd: "colorwc", data: { color: { r: 0, g: 12, b: 8 }, colorTemInKelvin: 0 } });
    expect(JSON.parse(devStatusCommand()).msg.cmd).toBe("devStatus");
  });
  it("parses devStatus replies", () => {
    const s = parseDevStatus({ msg: { cmd: "devStatus", data: { onOff: 1, brightness: 100, color: { r: 255, g: 0, b: 0 }, colorTemInKelvin: 7200 } } });
    expect(s).toMatchObject({ onOff: true, brightness: 100 });
    expect(parseDevStatus({})).toBeNull();
  });
  it("single-zone fallback picks the middle color (T-GOV-10 verified fallback, not the default path)", () => {
    // The default path is the segmented razer paint (B0/B4) proven byte-exact above.
    // collapseToSingleColor survives only for the verified single-zone fallback until T-GOV-10 removes it.
    expect(collapseToSingleColor(new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]))).toEqual([0, 255, 0]);
    expect(collapseToSingleColor(new Uint8Array([]))).toEqual([0, 0, 0]);
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
  it("closed streams drop pending frames instead of sending", async () => {
    const sent: Uint8Array[] = [];
    const factory: ToolkitStreamFactory = {
      openStream: async (_ip, _zones) => new LatestStream((f) => { sent.push(f); }),
    };
    const stream = await factory.openStream("10.0.0.2", 14);
    stream.setAll(new Uint8Array([1, 2, 3]));
    stream.close();
    stream.setAll(new Uint8Array([4, 5, 6]));
    stream.flush();
    expect(sent.length).toBe(0);
    expect(sent).toEqual([]);
  });
  it("encodes the arm golden vector byte-exact (bb 00 01 b1 01 0a)", () => {
    expect(hexOf(arm(true))).toBe("bb0001b1010a");
    expect(hexOf(arm(false))).toBe("bb0001b1000b");
  });
  it("re-encodes every razer fixture byte-exact", () => {
    const dir = fixtureDir();
    const names = readdirSync(dir).filter((n) => n.endsWith(".json") && n !== "status-armed.json");
    expect(names.length).toBeGreaterThanOrEqual(18);
    for (const name of names) {
      const vec = JSON.parse(readFileSync(join(dir, name), "utf8")) as { hex: string; base64: string };
      const raw = new Uint8Array(Buffer.from(vec.base64, "base64"));
      expect(hexOf(raw)).toBe(vec.hex);
      const decoded = decodeRaw(raw);
      expect(decoded).not.toBeNull();
      expect(hexOf(encodeRaw(decoded!.opcode, decoded!.payload))).toBe(vec.hex);
    }
    const status = JSON.parse(readFileSync(join(dir, "status-armed.json"), "utf8")) as {
      json: { msg: { cmd: string; data: { onOff: number; brightness: number; pt: string } } };
    };
    const parsed = parseStatus(status.json);
    expect(parsed).toMatchObject({ onOff: true, brightness: 80, armed: true });
  });
  it("round-trips decode(encode(x)) with checksum validation", () => {
    let seed = 0x12345678;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed & 0xff;
    };
    for (let round = 0; round < 200; round++) {
      const len = next() % 64;
      const payload = new Uint8Array(len);
      for (let i = 0; i < len; i++) payload[i] = next();
      const opcode = [0xb0, 0xb1, 0xb2, 0xb4][round % 4]!;
      const frame = encodeRaw(opcode, payload);
      const decoded = decodeRaw(frame);
      expect(decoded?.opcode).toBe(opcode);
      expect(decoded ? [...decoded.payload] : []).toEqual([...payload]);
      const corrupt = new Uint8Array(frame);
      corrupt[corrupt.length - 1]! ^= 0xff;
      expect(decodeRaw(corrupt)).toBeNull();
    }
    const colors = new Uint8Array([255, 0, 0, 0, 255, 0]);
    expect(hexOf(paint(colors, 0))).toBe(hexOf(encodeRaw(0xb0, new Uint8Array([0, 2, 255, 0, 0, 0, 255, 0]))));
    expect(() => paint(new Uint8Array([1, 2]), 0)).toThrow(RangeError);
    const zoned = paintZoned([{ r: 1, g: 2, b: 3, zone: 4 }], 1);
    expect(decodeRaw(zoned)?.opcode).toBe(0xb4);
    const env = JSON.parse(envelope(arm(true))) as { msg: { cmd: string; data: { pt: string } } };
    expect(env.msg.cmd).toBe("razer");
    expect(hexOf(new Uint8Array(Buffer.from(env.msg.data.pt, "base64")))).toBe("bb0001b1010a");
    expect(parseStatus({ msg: { cmd: "status", data: { onOff: 1, brightness: 50, pt: "!!!" } } })?.armed).toBe(false);
    expect(parseStatus({ msg: { cmd: "devStatus", data: {} } })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { createSocket } from "node:dgram";
import {
  OPCODE, arm, paint, paintZoned, envelope, decodeRaw, parseStatus,
  turnCommand, brightnessCommand, colorCommand, devStatusCommand, SCAN_REQUEST,
} from "@autolight/govee";
import { GoveeLanSim } from "./govee-lan.js";
import { RecordingTransport, FaultInjectingTransport, classifyDatagram } from "./recording.js";

function sendTo(port: number, text: string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const sock = createSocket("udp4");
  sock.on("error", (err) => {
    sock.close();
    reject(err);
  });
  sock.send(text, port, "127.0.0.1", (err) => {
    sock.close();
    if (err) reject(err);
    else resolve();
  });
  return promise;
}

const PROFILE = { device: "AA:BB:CC:DD:EE:FF", sku: "H6076", zones: 14, armSettleMs: 5 };

async function armedSim(port: number, sim: GoveeLanSim): Promise<void> {
  await sendTo(port, JSON.stringify({ msg: { cmd: "turn", data: { value: 1 } } }));
  await sendTo(port, envelope(arm(true)));
  await new Promise((r) => setTimeout(r, 20));
  expect(sim.armedState).toBe(true);
}

describe("govee-lan simulator", () => {
  it("answers scan with a device reply", async () => {
    // Real UDP on loopback: the simulator answers scan. Replies go to the
    // sender socket, so this test listens on its own port and waits for the
    // reply event instead of guessing a delay.
    const sim = new GoveeLanSim(PROFILE, { armSettle: false, rateCeiling: false });
    const port = await sim.start();
    const listener = createSocket("udp4");
    try {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const timer = setTimeout(() => reject(new Error("no scan reply")), 500);
      timer.unref?.();
      listener.on("message", (msg) => {
        clearTimeout(timer);
        resolve(msg.toString());
      });
      listener.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      await new Promise<void>((res, rej) => {
        listener.bind(0, "127.0.0.1", () => {
          listener.send(JSON.stringify(SCAN_REQUEST), port, "127.0.0.1", (err) => {
            if (err) rej(err);
            else res();
          });
        });
      });
      const text = await promise;
      expect(text).toContain("AA:BB:CC:DD:EE:FF");
    } finally {
      listener.close();
      await sim.stop();
    }
  });

  it("arms, paints B0 zones, and reports B2 armed in status", async () => {
    const sim = new GoveeLanSim(PROFILE, { armSettle: false, rateCeiling: false });
    const port = await sim.start();
    try {
      await armedSim(port, sim);
      const colors = new Uint8Array(14 * 3);
      colors[0] = 255;
      colors[41] = 255;
      await sendTo(port, envelope(paint(colors, 0)));
      await new Promise((r) => setTimeout(r, 20));
      expect(sim.rendered[0]).toEqual([255, 0, 0]);
      expect(sim.rendered[13]).toEqual([0, 0, 255]);
      expect(sim.metrics.paintsApplied).toBe(1);
      await sendTo(port, JSON.stringify({ msg: { cmd: "status", data: {} } }));
      await new Promise((r) => setTimeout(r, 30));
      expect(sim.metrics.statusQueries).toBe(1);
      const armedFrame = new Uint8Array([0xbb, 0, 1, OPCODE.ARM_STATUS, 1, 0xbb ^ 0 ^ 1 ^ OPCODE.ARM_STATUS ^ 1]);
      const parsed = parseStatus({
        msg: { cmd: "status", data: { onOff: 1, brightness: 100, pt: Buffer.from(armedFrame).toString("base64") } },
      });
      expect(parsed?.armed).toBe(true);
    } finally {
      await sim.stop();
    }
  });

  it("paints B4 zoned entries", async () => {
    const sim = new GoveeLanSim(PROFILE, { armSettle: false, rateCeiling: false });
    const port = await sim.start();
    try {
      await armedSim(port, sim);
      await sendTo(port, envelope(paintZoned([{ r: 9, g: 8, b: 7, zone: 5 }], 1)));
      await new Promise((r) => setTimeout(r, 20));
      expect(sim.rendered[5]).toEqual([9, 8, 7]);
    } finally {
      await sim.stop();
    }
  });

  it("drops the third back-to-back command", async () => {
    const sim = new GoveeLanSim(PROFILE, { armSettle: false, rateCeiling: false });
    const port = await sim.start();
    try {
      await sendTo(port, turnCommand(true));
      await sendTo(port, brightnessCommand(40));
      await sendTo(port, colorCommand(1, 2, 3));
      await new Promise((r) => setTimeout(r, 30));
      expect(sim.metrics.droppedBackToBack).toBe(1);
    } finally {
      await sim.stop();
    }
  });

  it("turn ends the channel and white kelvin ends the channel", async () => {
    const sim = new GoveeLanSim(PROFILE, { armSettle: false, rateCeiling: false });
    const port = await sim.start();
    try {
      await armedSim(port, sim);
      await sendTo(port, turnCommand(true));
      await new Promise((r) => setTimeout(r, 20));
      expect(sim.armedState).toBe(false);
      await sendTo(port, JSON.stringify({ msg: { cmd: "turn", data: { value: 1 } } }));
      await sendTo(port, envelope(arm(true)));
      await new Promise((r) => setTimeout(r, 20));
      expect(sim.armedState).toBe(true);
      await sendTo(port, JSON.stringify({ msg: { cmd: "colorwc", data: { color: { r: 255, g: 255, b: 255 }, colorTemInKelvin: 6500 } } }));
      await new Promise((r) => setTimeout(r, 20));
      expect(sim.armedState).toBe(false);
    } finally {
      await sim.stop();
    }
  });

  it("stays silent on status while armed", async () => {
    const sim = new GoveeLanSim(PROFILE, { armSettle: false, rateCeiling: false });
    const port = await sim.start();
    try {
      await armedSim(port, sim);
      await sendTo(port, JSON.stringify({ msg: { cmd: "status", data: {} } }));
      await sendTo(port, devStatusCommand());
      await new Promise((r) => setTimeout(r, 40));
      expect(sim.metrics.statusQueries).toBe(2);
    } finally {
      await sim.stop();
    }
  });

  it("loses paints during arm settle and stutters past the rate ceiling", async () => {
    const sim = new GoveeLanSim({ ...PROFILE, armSettleMs: 200 });
    const port = await sim.start();
    try {
      await sendTo(port, JSON.stringify({ msg: { cmd: "turn", data: { value: 1 } } }));
      await sendTo(port, envelope(arm(true)));
      await sendTo(port, envelope(paint(new Uint8Array(14 * 3).fill(7), 0)));
      await new Promise((r) => setTimeout(r, 30));
      expect(sim.metrics.paintsApplied).toBe(0);
      await new Promise((r) => setTimeout(r, 220));
      const colors = new Uint8Array(14 * 3).fill(9);
      for (let i = 0; i < 6; i++) {
        await sendTo(port, envelope(paint(colors, 0)));
      }
      await new Promise((r) => setTimeout(r, 40));
      expect(sim.metrics.paintsStuttered).toBeGreaterThan(0);
    } finally {
      await sim.stop();
    }
  });

  it("disappears, changes IP, and reports loss metrics", async () => {
    const sim = new GoveeLanSim(PROFILE, {
      armSettle: false, rateCeiling: false, lossEvery: 2, disappearAt: 3, reappearAt: 6, changedIp: "127.0.0.2",
    });
    const port = await sim.start();
    try {
      for (let i = 0; i < 7; i++) {
        await sendTo(port, devStatusCommand());
      }
      await new Promise((r) => setTimeout(r, 40));
      expect(sim.metrics.droppedLoss).toBeGreaterThan(0);
      expect(sim.replyIp()).toBe("127.0.0.2");
    } finally {
      await sim.stop();
    }
  });

  it("recording transport classifies every datagram with timestamps", () => {
    const seen: string[] = [];
    const rec = new RecordingTransport((t) => seen.push(t));
    const before = Date.now();
    rec.send(turnCommand(true));
    rec.send(envelope(arm(true)));
    rec.send(devStatusCommand());
    rec.send("not json");
    expect(seen).toHaveLength(4);
    expect(rec.count("turn")).toBe(1);
    expect(rec.count("razer")).toBe(1);
    expect(rec.count("devStatus")).toBe(1);
    expect(rec.count("other")).toBe(1);
    expect(rec.records[0]!.atMs).toBeGreaterThanOrEqual(before);
    expect(classifyDatagram(brightnessCommand(10))).toBe("brightness");
    expect(classifyDatagram(colorCommand(1, 2, 3))).toBe("colorwc");
  });

  it("recording transport shows zero turn commands while armed", () => {
    const rec = new RecordingTransport(() => undefined);
    rec.send(JSON.stringify({ msg: { cmd: "turn", data: { value: 1 } } }));
    rec.send(envelope(arm(true)));
    rec.send(envelope(paint(new Uint8Array([1, 2, 3]), 0)));
    const armedIdx = rec.records.findIndex((r) => r.kind === "razer");
    const turnsAfterArm = rec.records.slice(armedIdx).filter((r) => r.kind === "turn");
    expect(turnsAfterArm).toHaveLength(0);
  });

  it("fault-injecting transport drops, duplicates, and reorders", async () => {
    const seen: string[] = [];
    const drop = new FaultInjectingTransport((t) => seen.push(t), { dropEvery: 2 });
    drop.send("a");
    drop.send("b");
    drop.send("c");
    drop.send("d");
    expect(seen).toEqual(["a", "c"]);
    const dupSeen: string[] = [];
    const dup = new FaultInjectingTransport((t) => dupSeen.push(t), { duplicateEvery: 2 });
    dup.send("a");
    dup.send("b");
    expect(dupSeen).toEqual(["a", "b", "b"]);
    const ordSeen: string[] = [];
    const ord = new FaultInjectingTransport((t) => ordSeen.push(t), { reorderHold: true });
    ord.send("first");
    ord.send("second");
    ord.flush();
    expect(ordSeen).toEqual(["first", "second"]);
    const latSeen: string[] = [];
    const lat = new FaultInjectingTransport((t) => latSeen.push(t), { latencyMs: 20 });
    lat.send("slow");
    expect(latSeen).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 60));
    expect(latSeen).toEqual(["slow"]);
  });

  it("rejects corrupt razer frames at decode", () => {
    const frame = arm(true);
    const bad = new Uint8Array(frame);
    bad[bad.length - 1]! ^= 0xff;
    expect(decodeRaw(bad)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { createSocket, type Socket } from "node:dgram";
import {
  arm, paint, paintZoned, envelope, decodeRaw, parseStatus,
  turnCommand, brightnessCommand, colorCommand, devStatusCommand, SCAN_REQUEST,
} from "@autolight/govee";
import { GoveeLanSim } from "./govee-lan.js";
import { RecordingTransport, FaultInjectingTransport, classifyDatagram, malformedDatagrams } from "./recording.js";

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

// Poll until the expected state stabilizes, for state the simulator exposes
// only as a getter (it has no completion signal to await). Short poll, never a
// long guess: real UDP over loopback cannot run under fake timers.
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");

    await new Promise((r) => setTimeout(r, 5));
  }
}

// Resolves on the socket's own "message" signal once `count` replies have
// landed: an event, not a guessed duration.
function waitForDatagrams(listener: Listener, count: number): Promise<void> {
  if (listener.received.length >= count) return Promise.resolve();
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const check = (): void => {
    if (listener.received.length < count) return;
    listener.socket.off("message", check);
    resolve();
  };

  listener.socket.on("message", check);
  listener.socket.once("error", reject);

  return promise;
}

// A bound listener socket that stays open, so the simulator's replies (sent to
// the sender's address) can be captured instead of lost when a throwaway
// sender socket closes.
interface Listener {
  socket: Socket;
  received: string[];
  sendTo(port: number, text: string): Promise<void>;
}

async function listenOn(): Promise<Listener> {
  const { promise, resolve, reject } = Promise.withResolvers<Listener>();
  const socket = createSocket("udp4");
  const received: string[] = [];
  socket.on("message", (msg) => { received.push(msg.toString()); });
  socket.on("error", (err) => { reject(err); });
  socket.bind(0, "127.0.0.1", () => {
    resolve({
      socket,
      received,
      sendTo: (port, text) => {
        const sent = Promise.withResolvers<void>();
        socket.send(text, port, "127.0.0.1", (err) => (err ? sent.reject(err) : sent.resolve()));

        return sent.promise;
      },
    });
  });

  return promise;
}

async function armedSim(port: number, sim: GoveeLanSim): Promise<void> {
  await sendTo(port, JSON.stringify({ msg: { cmd: "turn", data: { value: 1 } } }));
  await sendTo(port, envelope(arm(true)));
  await waitFor(() => sim.armedState);
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
    // silentStatusWhileArmed is off so the armed status reply really exists;
    // parsing the captured datagram proves the B2 armed bit without a
    // hand-built frame.
    const sim = new GoveeLanSim(PROFILE, { armSettle: false, rateCeiling: false, silentStatusWhileArmed: false });
    const port = await sim.start();
    const listener = await listenOn();

    try {
      await armedSim(port, sim);
      const colors = new Uint8Array(14 * 3);
      colors[0] = 255;
      colors[41] = 255;
      await listener.sendTo(port, envelope(paint(colors, 0)));
      await listener.sendTo(port, JSON.stringify({ msg: { cmd: "status", data: {} } }));
      // The status reply is the barrier: once it lands, the paint above was
      // already applied (same socket order), so no sleep is needed.
      await waitForDatagrams(listener, 1);
      expect(sim.rendered[0]).toEqual([255, 0, 0]);
      expect(sim.rendered[13]).toEqual([0, 0, 255]);
      expect(sim.metrics.paintsApplied).toBe(1);
      expect(listener.received).toHaveLength(1);
      const reply = listener.received[0];
      expect(reply).toBeDefined();
      const parsed = reply === undefined ? null : parseStatus(JSON.parse(reply));
      expect(parsed?.armed).toBe(true);
    } finally {
      listener.socket.close();
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
    const listener = await listenOn();

    try {
      await armedSim(port, sim);
      await listener.sendTo(port, JSON.stringify({ msg: { cmd: "status", data: {} } }));
      await listener.sendTo(port, devStatusCommand());
      await waitFor(() => sim.metrics.statusQueries === 2);

      // The armed queries must emit nothing. Disarming turns the same query
      // into a real reply, which is the barrier proving the armed phase
      // emitted no datagram (and that this listener is not simply deaf).
      await listener.sendTo(port, turnCommand(true));
      await listener.sendTo(port, JSON.stringify({ msg: { cmd: "status", data: {} } }));
      await waitForDatagrams(listener, 1);
      expect(sim.metrics.statusQueries).toBe(3);
      expect(listener.received).toHaveLength(1);
    } finally {
      listener.socket.close();
      await sim.stop();
    }
  });

  it("loses paints during the arm settle window", async () => {
    // The sim confirms the arm over the status channel, so enable replies: the
    // reply is the barrier proving the paint was already handled, no sleep.
    const sim = new GoveeLanSim({ ...PROFILE, armSettleMs: 200 }, { silentStatusWhileArmed: false });
    const port = await sim.start();
    const listener = await listenOn();

    try {
      await listener.sendTo(port, JSON.stringify({ msg: { cmd: "turn", data: { value: 1 } } }));
      await listener.sendTo(port, envelope(arm(true)));
      await waitFor(() => sim.armedState);
      await listener.sendTo(port, envelope(paint(new Uint8Array(14 * 3).fill(7), 0)));
      await listener.sendTo(port, JSON.stringify({ msg: { cmd: "status", data: {} } }));
      // Once the status reply lands, the paint above (same socket order) was
      // already handled. Inside the 200ms settle window it applies nothing.
      await waitForDatagrams(listener, 1);
      expect(sim.metrics.paintsApplied).toBe(0);
    } finally {
      listener.socket.close();
      await sim.stop();
    }
  });

  it("stutters exactly the paints that exceed the rate ceiling", async () => {
    const sim = new GoveeLanSim(PROFILE, { armSettle: false, silentStatusWhileArmed: false });
    const port = await sim.start();
    const listener = await listenOn();
    const colors = new Uint8Array(14 * 3).fill(9);

    try {
      await listener.sendTo(port, JSON.stringify({ msg: { cmd: "turn", data: { value: 1 } } }));
      await listener.sendTo(port, envelope(arm(true)));
      await waitFor(() => sim.armedState);
      // Two paints in one burst: the second lands inside the 25ms gap for 14
      // zones (40 Hz), so exactly one applies and one stutters. The status
      // reply proves both were handled before the counts are read.
      await listener.sendTo(port, envelope(paint(colors, 0)));
      await listener.sendTo(port, envelope(paint(colors, 0)));
      await listener.sendTo(port, JSON.stringify({ msg: { cmd: "status", data: {} } }));
      await waitForDatagrams(listener, 1);
      expect(sim.metrics.paintsApplied).toBe(1);
      expect(sim.metrics.paintsStuttered).toBe(1);
    } finally {
      listener.socket.close();
      await sim.stop();
    }
  });
  it("disappears, changes IP, and reports loss metrics", async () => {
    const sim = new GoveeLanSim(PROFILE, {
      armSettle: false, rateCeiling: false, lossEvery: 2, disappearAt: 3, reappearAt: 6, changedIp: "127.0.0.2",
    });

    const port = await sim.start();
    const listener = await listenOn();

    try {
      // Packet 1 answers while visible; packet 2 is the first loss drop.
      await listener.sendTo(port, JSON.stringify(SCAN_REQUEST));
      await listener.sendTo(port, JSON.stringify(SCAN_REQUEST));
      await waitForDatagrams(listener, 1);

      // Packets 3-5 fall in the disappeared window (#4 also hits loss, but the
      // gone check runs first), #6 is dropped by loss, and #7 answers after
      // reappearing. Seven scans yield exactly two replies: the absence is the
      // disappearance proof, and each captured reply's IP is bound to the
      // sim's live replyIp() instead of the getter being asserted in a vacuum.
      for (let i = 0; i < 5; i++) {
        await listener.sendTo(port, JSON.stringify(SCAN_REQUEST));
      }

      await waitForDatagrams(listener, 2);
      // Reply 1 was captured before reappearance (old IP), reply 2 after
      // (new IP): historical replies carry historical IPs, not live state.
      const ips = listener.received.map((reply) => JSON.parse(reply)?.msg?.data?.ip);
      expect(ips).toEqual(["127.0.0.1", "127.0.0.2"]);
      expect(sim.replyIp()).toBe("127.0.0.2");
    } finally {
      listener.socket.close();
      await sim.stop();
    }
  });

  it("recording transport classifies every datagram with timestamps", () => {
    const seen: string[] = [];
    let clock = 1000;
    // Injectable clock: timestamps are deterministic, not wall-clock reads.
    const rec = new RecordingTransport((t) => seen.push(t), () => (clock += 5));
    const malformedBefore = malformedDatagrams;
    rec.send(turnCommand(true));
    rec.send(envelope(arm(true)));
    rec.send(devStatusCommand());
    rec.send("not json");
    expect(seen).toHaveLength(4);
    expect(rec.count("turn")).toBe(1);
    expect(rec.count("razer")).toBe(1);
    expect(rec.count("devStatus")).toBe(1);
    expect(rec.count("other")).toBe(1);
    expect(rec.records.map((r) => r.atMs)).toEqual([1005, 1010, 1015, 1020]);
    // The malformed datagram is counted, not silently swallowed.
    expect(malformedDatagrams).toBe(malformedBefore + 1);
    expect(classifyDatagram(brightnessCommand(10))).toBe("brightness");
    expect(classifyDatagram(colorCommand(1, 2, 3))).toBe("colorwc");
  });

  it("records an armed channel as paint-only, and a turn as the channel's end", async () => {
    // The old test only ever saw a pre-arm turn and excluded it by slicing at
    // the first razer record, so it passed with no turns possible. This one
    // drives the simulator's armed channel: the arm record anchors the window,
    // paints prove the channel is live, and a turn is the positive control
    // that the recorder sees turns and that the turn really ends the channel.
    const sim = new GoveeLanSim(PROFILE, { armSettle: false, rateCeiling: false });
    const port = await sim.start();
    const sock = createSocket("udp4");
    const rec = new RecordingTransport((text) => { sock.send(text, port, "127.0.0.1", () => undefined); });

    try {
      rec.send(envelope(arm(true)));
      await waitFor(() => sim.armedState);
      rec.send(envelope(paint(new Uint8Array(14 * 3).fill(3), 0)));
      await waitFor(() => sim.metrics.paintsApplied === 1);

      const armedIdx = rec.records.findIndex((r) => r.kind === "razer");
      expect(armedIdx).toBeGreaterThanOrEqual(0);
      expect(rec.count("turn")).toBe(0);

      rec.send(turnCommand(true));
      await waitFor(() => !sim.armedState);
      const turnsAfterArm = rec.records.slice(armedIdx).filter((r) => r.kind === "turn");
      expect(turnsAfterArm).toHaveLength(1);
    } finally {
      sock.close();
      await sim.stop();
    }
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
    // Duplication is no longer dropped when the reorder hold is on: every
    // datagram keeps its own sequence, so the held one duplicates too.
    const bothSeen: string[] = [];
    const both = new FaultInjectingTransport((t) => bothSeen.push(t), { reorderHold: true, duplicateEvery: 1 });
    both.send("first");
    both.send("second");
    both.flush();
    expect(bothSeen).toEqual(["first", "first", "second", "second"]);
    // drain() forces latency-delayed datagrams out instead of losing them.
    const forced: string[] = [];
    const forcedLat = new FaultInjectingTransport((t) => forced.push(t), { latencyMs: 10_000 });
    forcedLat.send("held");
    expect(forced).toHaveLength(0);
    forcedLat.drain();
    expect(latSeen).toEqual(["slow"]);
  });

  it("rejects corrupt razer frames at decode", () => {
    const frame = arm(true);
    const bad = new Uint8Array(frame);
    bad[bad.length - 1]! ^= 0xff;
    expect(decodeRaw(bad)).toBeNull();
  });

  it("turn resets the back-to-back counter on channel end", async () => {
    const sim = new GoveeLanSim(PROFILE, { armSettle: false, rateCeiling: false });
    const port = await sim.start();
    const listener = await listenOn();

    try {
      await listener.sendTo(port, JSON.stringify({ msg: { cmd: "turn", data: { value: 1 } } }));
      await listener.sendTo(port, envelope(arm(true)));
      await waitFor(() => sim.armedState);
      await listener.sendTo(port, turnCommand(true));
      await waitFor(() => !sim.armedState);
      await listener.sendTo(port, brightnessCommand(40));
      await listener.sendTo(port, colorCommand(1, 2, 3));
      await listener.sendTo(port, JSON.stringify({ msg: { cmd: "status", data: {} } }));
      await waitFor(() => sim.metrics.statusQueries === 1);
      expect(sim.metrics.droppedBackToBack).toBe(0);
    } finally {
      listener.socket.close();
      await sim.stop();
    }
  });

  it("rejects short paint payloads without counting them applied", async () => {
    const sim = new GoveeLanSim(PROFILE, { armSettle: false, rateCeiling: false });
    const port = await sim.start();
    const listener = await listenOn();

    try {
      await listener.sendTo(port, JSON.stringify({ msg: { cmd: "turn", data: { value: 1 } } }));
      await listener.sendTo(port, envelope(arm(true)));
      await waitFor(() => sim.armedState);
      const frame = paint(new Uint8Array([1, 2, 3]), 0);
      const short = new Uint8Array(frame.length - 1);
      short.set(frame.subarray(0, frame.length - 1));
      short[short.length - 1]! ^= 0xff;
      await listener.sendTo(port, envelope(short));
      await listener.sendTo(port, JSON.stringify({ msg: { cmd: "status", data: {} } }));
      await waitFor(() => sim.metrics.statusQueries === 1);
      expect(sim.metrics.paintsApplied).toBe(0);
      expect(sim.paintsSeen).toBe(0);
    } finally {
      listener.socket.close();
      await sim.stop();
    }
  });
});

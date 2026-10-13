// T-GOV-12 action tests: IDENTIFY, TEST CHASE, RECALIBRATE and the identify
// walk, asserted as exact datagrams on the recording fake transport (the fake
// lamp records every sendRaw and sendJson). Fleet v1 requirements fix the
// endpoint, protocol, and config behavior.
import { describe, expect, it } from "vitest";
import { identify, identifyWalk, recalibrate, testChase } from "./actions.js";
import { MemoryCalibrationStore, QualificationSession } from "./qualification.js";
import type { LanExchange } from "./probe.js";
import { FakeLamp, armLamp, goldenHex } from "./lan-fake.test-support.js";

const MAC_A = "AA:BB:CC:DD:EE:01";

const MAC_B = "AA:BB:CC:DD:EE:02";

const OPCODE_B0 = 0xb0;

const DEV_STATUS_COMMAND = JSON.stringify({ msg: { cmd: "devStatus", data: {} } });
const STATUS_COMMAND = JSON.stringify({ msg: { cmd: "status", data: {} } });

function turn(on: boolean): string {
  return JSON.stringify({ msg: { cmd: "turn", data: { value: on ? 1 : 0 } } });
}
function colorwc(r: number, g: number, b: number): string {
  return JSON.stringify({ msg: { cmd: "colorwc", data: { color: { r, g, b }, colorTemInKelvin: 0 } } });
}

function brightness(value: number): string {
  return JSON.stringify({ msg: { cmd: "brightness", data: { value } } });
}

/** One zone lit white, the rest black: the travel frame of TEST CHASE. */
function travelPayload(zones: number, lit: number): number[] {
  const payload = [0, zones];

  for (let zone = 0; zone < zones; zone++) {
    payload.push(...(zone === lit ? [255, 255, 255] : [0, 0, 0]));
  }

  return payload;
}

function whitePayload(zones: number): number[] {
  const payload = [0, zones];

  for (let zone = 0; zone < zones; zone++) payload.push(255, 255, 255);

  return payload;
}

/** Routes datagrams by device id, the way the manager keys devices by MAC
 *  (T-GOV-06). */
class LampRouter implements LanExchange {
  constructor(private readonly lamps: Map<string, FakeLamp>) {}

  sendJson(deviceId: string, text: string): void {
    this.lamps.get(deviceId)?.sendJson(deviceId, text);
  }

  sendRaw(deviceId: string, raw: Uint8Array): void {
    this.lamps.get(deviceId)?.sendRaw(deviceId, raw);
  }

  reply(deviceId: string, timeoutMs: number): Promise<string | null> {
    const lamp = this.lamps.get(deviceId);

    if (lamp === undefined) return Promise.resolve(null);

    return lamp.reply(deviceId, timeoutMs);
  }
}

describe("govee device actions", () => {
  it("IDENTIFY flashes through the armed stream and restores the current frame, byte exact", async () => {
    const lamp = new FakeLamp({
      device: MAC_A,
      ip: "10.0.0.42",
      sku: "H6076",
      firmware: "1.02.03",
      zones: 4,
      behaviour: "segmented",
      armSettleMs: 0,
      answersStatusWhileArmed: false,
    });

    const showFrame = new Uint8Array([10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0]);
    armLamp(lamp);

    const result = await identify(
      lamp,
      { hardwareId: MAC_A, zones: 4, capability: "segmented", orientation: "forward", armed: true, currentFrame: showFrame },
      { flashMs: 5, minSpacingMs: 0, captureTimeoutMs: 5 },
    );

    expect(result.path).toBe("stream");
    expect(result.restored).toBe("current-frame");
    expect(result.framesSentHex).toEqual([
      goldenHex(OPCODE_B0, whitePayload(4)),
      goldenHex(OPCODE_B0, [0, 4, 10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0]),
    ]);
    // Live armed-state read-back first (silent while armed), then the stream
    // flash and restore. While armed: no turn, no white colorwc (either would
    // end the channel).
    expect(result.commandsSent.filter((sent) => sent !== DEV_STATUS_COMMAND && sent !== STATUS_COMMAND)).toEqual([]);
    expect(result.commandsSent).toContain(STATUS_COMMAND);
    expect(result.commandsSent.length).toBeGreaterThan(0);
  });
  it("armed snap effects never touch colorwc: the firmware would fade them", async () => {

    const lamp = new FakeLamp({
      device: MAC_A,
      ip: "10.0.0.42",
      sku: "H6076",
      firmware: "1.02.03",
      zones: 4,
      behaviour: "segmented",
      armSettleMs: 0,
      answersStatusWhileArmed: false,
    });

    const showFrame = new Uint8Array([10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0]);
    armLamp(lamp);

    const identified = await identify(
      lamp,
      { hardwareId: MAC_A, zones: 4, capability: "segmented", orientation: "forward", armed: true, currentFrame: showFrame },
      { flashMs: 5, minSpacingMs: 0, captureTimeoutMs: 5 },
    );

    const chased = await testChase(
      lamp,
      { hardwareId: MAC_A, zones: 4, capability: "segmented", orientation: "forward", armed: true },
      { stepMs: 1, minSpacingMs: 0 },
    );

    // Hardware receipt 2026-10-12: colorwc eases between colors, so any
    // colorwc here would render a fade, not the snap the caller asked for.
    for (const sent of [...identified.commandsSent, ...chased.commandsSent]) {
      expect(sent).not.toContain('"colorwc"');
    }

    expect(identified.framesSentHex.length).toBeGreaterThan(0);
    expect(chased.framesSentHex.length).toBeGreaterThan(0);
  });
  it("IDENTIFY flashes through colorwc when unarmed and restores the observed state", async () => {
    const lamp = new FakeLamp({
      device: MAC_A,
      ip: "10.0.0.42",
      sku: "H6076",
      firmware: "1.02.03",
      zones: 4,
      behaviour: "segmented",
      brightness: 42,
      color: [7, 8, 9],
    });

    const result = await identify(
      lamp,
      { hardwareId: MAC_A, zones: 4, capability: "segmented", orientation: "forward", armed: false },
      { flashMs: 5, minSpacingMs: 0, captureTimeoutMs: 20 },
    );

    expect(result.path).toBe("colorwc");
    expect(result.restored).toBe("observed-state");
    expect(result.observed).toEqual({ onOff: true, brightness: 42, r: 7, g: 8, b: 9 });
    expect(result.observedAnswered).toBe(true);
    expect(result.commandsSent).toEqual([
      STATUS_COMMAND,
      DEV_STATUS_COMMAND,
      turn(true),
      colorwc(255, 255, 255),
      brightness(42),
      colorwc(7, 8, 9),
    ]);
    expect(result.framesSentHex).toEqual([]);
    expect(lamp.color).toEqual([7, 8, 9]);
    expect(lamp.brightness).toBe(42);
  });

  it("TEST CHASE walks one zone out and back, byte exact", async () => {
    const lamp = new FakeLamp({
      device: MAC_A,
      ip: "10.0.0.42",
      sku: "H6076",
      firmware: "1.02.03",
      zones: 4,
      behaviour: "segmented",
      armSettleMs: 0,
    });

    armLamp(lamp);

    const result = await testChase(
      lamp,
      { hardwareId: MAC_A, zones: 4, capability: "segmented", orientation: "forward", armed: true },
      { stepMs: 1, minSpacingMs: 0 },
    );
    expect(result.mode).toBe("stream");
    expect(result.directions).toEqual(["forward", "reverse"]);
    expect(result.zoneOrder).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);
    expect(result.framesSentHex).toEqual([
      goldenHex(OPCODE_B0, travelPayload(4, 0)),
      goldenHex(OPCODE_B0, travelPayload(4, 1)),
      goldenHex(OPCODE_B0, travelPayload(4, 2)),
      goldenHex(OPCODE_B0, travelPayload(4, 3)),
      goldenHex(OPCODE_B0, travelPayload(4, 3)),
      goldenHex(OPCODE_B0, travelPayload(4, 2)),
      goldenHex(OPCODE_B0, travelPayload(4, 1)),
      goldenHex(OPCODE_B0, travelPayload(4, 0)),
      // Restore: no prior frame, so the chase ends on blackout, not the last zone.
      goldenHex(OPCODE_B0, [0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ]);
    // What the unit actually rendered, in order: the zone travel, then the
    // blackout restore (-1: no zone lit).
    expect(lamp.zoneLog).toEqual([0, 1, 2, 3, 3, 2, 1, 0, -1]);
    expect(result.commandsSent).toEqual([]);
  });

  it("TEST CHASE restores the prior frame instead of the last travel frame", async () => {
    const lamp = new FakeLamp({
      device: MAC_A,
      ip: "10.0.0.42",
      sku: "H6076",
      firmware: "1.02.03",
      zones: 4,
      behaviour: "segmented",
      armSettleMs: 0,
    });

    armLamp(lamp);
    const prior = new Uint8Array([10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0]);

    const result = await testChase(
      lamp,
      { hardwareId: MAC_A, zones: 4, capability: "segmented", orientation: "forward", armed: true, currentFrame: prior },
      { stepMs: 1, minSpacingMs: 0 },
    );

    expect(result.framesSentHex[result.framesSentHex.length - 1]).toBe(
      goldenHex(OPCODE_B0, [0, 4, 10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0]),
    );
    expect(lamp.painted).toEqual([[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0]]);
  });

  it("TEST CHASE on a single-zone fixture is a three-step brightness ramp", async () => {
    const lamp = new FakeLamp({
      device: MAC_A,
      ip: "10.0.0.42",
      sku: "H6076",
      firmware: "1.02.03",
      zones: 1,
      behaviour: "segmented",
    });

    const result = await testChase(
      lamp,
      { hardwareId: MAC_A, zones: 1, capability: "single-zone", orientation: "forward", armed: false },
      { stepMs: 1, minSpacingMs: 0 },
    );
    expect(result.mode).toBe("ramp");
    expect(result.frameCount).toBe(3);
    // Linear-light scaling of RGB white (spec 49): round(255 * intensity^(1/2.2)).
    // The chase restores black afterwards instead of leaving the unit white.
    expect(result.commandsSent).toEqual([colorwc(136, 136, 136), colorwc(202, 202, 202), colorwc(255, 255, 255), colorwc(0, 0, 0)]);
    expect(lamp.color).toEqual([0, 0, 0]);
  });

  it("TEST CHASE on an armed single-zone fixture ramps through the stream, never colorwc", async () => {
    const lamp = new FakeLamp({
      device: MAC_A,
      ip: "10.0.0.42",
      sku: "H6076",
      firmware: "1.02.03",
      zones: 1,
      behaviour: "segmented",
      armSettleMs: 0,
    });

    armLamp(lamp);

    const result = await testChase(
      lamp,
      { hardwareId: MAC_A, zones: 1, capability: "single-zone", orientation: "forward", armed: true },
      { stepMs: 1, minSpacingMs: 0 },
    );
    expect(result.mode).toBe("ramp");
    // A colorwc while armed can end the channel, so the ramp is stream frames.
    expect(result.commandsSent).toEqual([]);
    expect(result.framesSentHex).toEqual([
      goldenHex(OPCODE_B0, [0, 1, 136, 136, 136]),
      goldenHex(OPCODE_B0, [0, 1, 202, 202, 202]),
      goldenHex(OPCODE_B0, [0, 1, 255, 255, 255]),
      goldenHex(OPCODE_B0, [0, 1, 0, 0, 0]),
    ]);
    expect(lamp.armed).toBe(true);
  });

  it("RECALIBRATE opens the wizard at the chosen step", async () => {
    const lamp = new FakeLamp({
      device: MAC_A,
      ip: "10.0.0.42",
      sku: "H6076",
      firmware: "1.02.03",
      zones: 4,
      behaviour: "segmented",
    });

    const store = new MemoryCalibrationStore();

    const session = QualificationSession.open({
      exchange: lamp,
      discovery: lamp.scanReply(),
      store,
      zones: 4,
      statusRetryMs: 5,
      statusDeadlineMs: 20,
      minSpacingMs: 0,
    });

    const result = recalibrate(session, 13);
    expect(result.ok).toBe(true);
    expect(result.action).toBe("recalibrate");
    expect(result.hardwareId).toBe(MAC_A);
    expect(result.step).toBe(13);
    expect(result.stepId).toBe("stable-rate");
    expect(session.nextStep()).toBe(13);
    expect(session.record("stable-rate")?.status).toBe("pending");
    expect(session.state.status).toBe("in-progress");
  });

  it("identify walk lights each unit in turn, in the order given", async () => {
    const lampA = new FakeLamp({
      device: MAC_A,
      ip: "10.0.0.41",
      sku: "H6076",
      firmware: "1.02.03",
      zones: 4,
      behaviour: "segmented",
      brightness: 30,
      color: [1, 2, 3],
    });

    const lampB = new FakeLamp({
      device: MAC_B,
      ip: "10.0.0.42",
      sku: "H1A45",
      firmware: "2.01.00",
      zones: 2,
      behaviour: "segmented",
      brightness: 60,
      color: [4, 5, 6],
    });

    const router = new LampRouter(new Map([
      [MAC_A, lampA],
      [MAC_B, lampB],
    ]));

    const paused: string[] = [];

    const result = await identifyWalk(
      router,
      [
        { hardwareId: MAC_B, zones: 2, capability: "segmented", orientation: "forward", armed: false },
        { hardwareId: MAC_A, zones: 4, capability: "segmented", orientation: "forward", armed: false },
      ],
      {
        flashMs: 1,
        minSpacingMs: 0,
        captureTimeoutMs: 20,
        pause: (index, hardwareId) => {
          paused.push(`${index}:${hardwareId}`);

          return Promise.resolve();
        },
      },
    );

    expect(result.order).toEqual([MAC_B, MAC_A]);
    // Each unit flashed and restored once, and only its own datagrams went out.
    // Live armed-state read-back, then devStatus, then power-on before white.
    expect(lampB.sentJson).toEqual([STATUS_COMMAND, DEV_STATUS_COMMAND, turn(true), colorwc(255, 255, 255), brightness(60), colorwc(4, 5, 6)]);
    expect(lampA.sentJson).toEqual([STATUS_COMMAND, DEV_STATUS_COMMAND, turn(true), colorwc(255, 255, 255), brightness(30), colorwc(1, 2, 3)]);
    expect(lampB.color).toEqual([4, 5, 6]);
    expect(lampA.color).toEqual([1, 2, 3]);
  });

  it("IDENTIFY trusts the live channel over a stale snapshot", async () => {
    // Snapshot says unarmed, but the unit holds an armed channel: the flash
    // must go through the stream, never a channel-killing colorwc.
    const lamp = new FakeLamp({
      device: MAC_A,
      ip: "10.0.0.42",
      sku: "H6076",
      firmware: "1.02.03",
      zones: 4,
      behaviour: "segmented",
      armSettleMs: 0,
    });

    armLamp(lamp);
    const showFrame = new Uint8Array([10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0]);

    const result = await identify(
      lamp,
      { hardwareId: MAC_A, zones: 4, capability: "segmented", orientation: "forward", armed: false, currentFrame: showFrame },
      { flashMs: 5, minSpacingMs: 0, captureTimeoutMs: 20 },
    );

    expect(result.path).toBe("stream");
    expect(result.restored).toBe("current-frame");
    expect(result.framesSentHex).toEqual([
      goldenHex(OPCODE_B0, whitePayload(4)),
      goldenHex(OPCODE_B0, [0, 4, 10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0]),
    ]);
    for (const sent of result.commandsSent) expect(sent).not.toContain('"colorwc"');
  });

  it("IDENTIFY restores even when the flash wait fails", async () => {
    const lamp = new FakeLamp({
      device: MAC_A,
      ip: "10.0.0.42",
      sku: "H6076",
      firmware: "1.02.03",
      zones: 4,
      behaviour: "segmented",
      brightness: 42,
      color: [7, 8, 9],
    });

    await expect(identify(
      lamp,
      { hardwareId: MAC_A, zones: 4, capability: "segmented", orientation: "forward", armed: false },
      { flashMs: 5, minSpacingMs: 0, captureTimeoutMs: 20, wait: () => Promise.reject(new Error("timer failed")) },
    )).rejects.toThrow("timer failed");
    // The restore still ran: the observed look came back, not white.
    expect(lamp.sentJson.slice(-2)).toEqual([brightness(42), colorwc(7, 8, 9)]);
    expect(lamp.color).toEqual([7, 8, 9]);
  });

  it("IDENTIFY blacks out when the pre-flash read-back times out", async () => {
    const lamp = new FakeLamp({
      device: MAC_A,
      ip: "10.0.0.42",
      sku: "H6076",
      firmware: "1.02.03",
      zones: 4,
      behaviour: "lan-absent",
    });

    const result = await identify(
      lamp,
      { hardwareId: MAC_A, zones: 4, capability: "segmented", orientation: "forward", armed: false },
      { flashMs: 1, minSpacingMs: 0, captureTimeoutMs: 5 },
    );

    expect(result.observed).toBeNull();
    expect(result.restored).toBe("no-read-back");
    expect(result.commandsSent.slice(-2)).toEqual([brightness(1), colorwc(0, 0, 0)]);
  });

  it("IDENTIFY rejects a mismatched restore frame with blackout", async () => {
    const lamp = new FakeLamp({
      device: MAC_A,
      ip: "10.0.0.42",
      sku: "H6076",
      firmware: "1.02.03",
      zones: 4,
      behaviour: "segmented",
      armSettleMs: 0,
      answersStatusWhileArmed: false,
    });

    armLamp(lamp);
    // Two zones of frame on a four-zone unit: resolution mismatch.
    const wrong = new Uint8Array([9, 9, 9, 8, 8, 8]);

    const result = await identify(
      lamp,
      { hardwareId: MAC_A, zones: 4, capability: "segmented", orientation: "forward", armed: true, currentFrame: wrong },
      { flashMs: 5, minSpacingMs: 0, captureTimeoutMs: 5 },
    );

    expect(result.restored).toBe("blackout-frame");
    expect(result.framesSentHex[result.framesSentHex.length - 1]).toBe(
      goldenHex(OPCODE_B0, [0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    );
  });

  it("TEST CHASE rejects absurd zone counts instead of throwing mid-walk", async () => {
    const lamp = new FakeLamp({
      device: MAC_A,
      ip: "10.0.0.42",
      sku: "H6076",
      firmware: "1.02.03",
      zones: 300,
      behaviour: "segmented",
      armSettleMs: 0,
    });

    armLamp(lamp);
    await expect(testChase(
      lamp,
      { hardwareId: MAC_A, zones: 300, capability: "segmented", orientation: "forward", armed: true },
      { stepMs: 1, minSpacingMs: 0 },
    )).rejects.toThrow(RangeError);
    expect(lamp.sentJson).toEqual([]);
    expect(lamp.zoneLog).toEqual([]);
  });
});

// T-GOV-10 capability probe tests: the three simulated firmware behaviours
// (segmented works, segmented silently ignored, LAN absent), byte-exact
// assertions through an independent protocol encoder, and the visible fallback
// states. The fake lamp speaks the real codec; no claim is made about hardware.
import { describe, expect, it } from "vitest";
import {
  LAN_TROUBLESHOOTING,
  LAN_UNAVAILABLE_BADGE,
  SINGLE_ZONE_BADGE,
  STATUS_COMMAND,
  fallbackOrder,
  probeSegmentedCapability,
} from "./probe.js";
import { FakeLamp, ScriptedUser, goldenHex } from "./lan-fake.test-support.js";

const MAC = "AA:BB:CC:DD:EE:01";
const SKU = "H6076";
const FIRMWARE = "1.02.03";
const ZONES = 4;
const OPCODE_ARM = 0xb1;
const OPCODE_B0 = 0xb0;
const OPCODE_B4 = 0xb4;
const DEV_STATUS_COMMAND = JSON.stringify({ msg: { cmd: "devStatus", data: {} } });
const TURN_ON_COMMAND = JSON.stringify({ msg: { cmd: "turn", data: { value: 1 } } });

function makeLamp(behaviour: "segmented" | "ignores-paints" | "lan-absent", over: Partial<{ armSettleMs: number; answersStatusWhileArmed: boolean }> = {}): FakeLamp {
  return new FakeLamp({
    device: MAC,
    ip: "10.0.0.42",
    sku: SKU,
    firmware: FIRMWARE,
    zones: ZONES,
    behaviour,
    armSettleMs: over.armSettleMs ?? 5,
    ...(over.answersStatusWhileArmed !== undefined ? { answersStatusWhileArmed: over.answersStatusWhileArmed } : {}),
  });
}

function identity() {
  return { hardwareId: MAC, sku: SKU, firmwareVersion: FIRMWARE, ip: "10.0.0.42" };
}

function options() {
  return { zones: ZONES, armSettleMs: 10, retryMs: 5, deadlineMs: 30, minSpacingMs: 0 };
}

/** Independent expectation for the two-colour paint: half red, half blue. */
function twoColourPayload(zones: number): number[] {
  const payload = [0, zones];
  const mid = Math.floor(zones / 2);
  for (let zone = 0; zone < zones; zone++) {
    payload.push(...(zone < mid ? [255, 0, 0] : [0, 0, 255]));
  }
  return payload;
}

/** Independent expectation for the B4 probe: first zone red, last zone blue. */
function zonedPayload(zones: number): number[] {
  return [0, 2, 255, 0, 0, 0, 0, 0, 255, zones - 1];
}

describe("govee segmented capability probe", () => {
  it("verifies the segmented channel from the user's confirmation, byte exact", async () => {
    const lamp = makeLamp("segmented", { answersStatusWhileArmed: true });
    const probe = await probeSegmentedCapability(lamp, identity(), new ScriptedUser(lamp), options());

    expect(probe.verdict.kind).toBe("segmented");
    expect(probe.verdict.verified).toBe(true);
    expect(probe.verdict.kind === "segmented" && probe.verdict.zones).toBe(ZONES);
    expect(probe.verdict.kind === "segmented" && probe.verdict.b4).toBe("confirmed");
    expect(probe.label).toBe(`SEGMENTED (${ZONES} zones, user confirmed)`);
    expect(probe.reachable).toBe(true);
    expect(probe.armedReadBack).toBe("armed");
    expect(probe.statusAnswered).toBe(true);
    expect(probe.b0Confirmed).toBe(true);
    expect(probe.b4Confirmed).toBe(true);

    // The exact datagrams: arm, the two-colour B0 paint, the B4 probe, disarm.
    expect(probe.framesSentHex).toEqual([
      goldenHex(OPCODE_ARM, [1]),
      goldenHex(OPCODE_B0, twoColourPayload(ZONES)),
      goldenHex(OPCODE_B4, zonedPayload(ZONES)),
      goldenHex(OPCODE_ARM, [0]),
    ]);
    // Power on before arming, and the B2 read-back after arming. Never a turn
    // while the channel is armed, never a white colorwc.
    expect(probe.commandsSent).toEqual([STATUS_COMMAND, TURN_ON_COMMAND, STATUS_COMMAND]);

    // The user's eyes match the unit: two colours, red half then blue half.
    expect(lamp.painted).toEqual([
      [255, 0, 0],
      [255, 0, 0],
      [0, 0, 255],
      [0, 0, 255],
    ]);
    expect(fallbackOrder(probe.verdict)).toEqual(["lan-razer"]);
  });

  it("treats a firmware that ignores paint as a visible fallback, never a success", async () => {
    const lamp = makeLamp("ignores-paints", { answersStatusWhileArmed: true });
    const probe = await probeSegmentedCapability(lamp, identity(), new ScriptedUser(lamp), options());

    expect(probe.verdict.kind).toBe("single-zone-fallback");
    expect(probe.verdict.verified).toBe(false);
    expect(probe.verdict.kind === "single-zone-fallback" && probe.verdict.degraded).toBe(true);
    expect(probe.verdict.kind === "single-zone-fallback" && probe.verdict.badge).toBe(SINGLE_ZONE_BADGE);
    expect(probe.verdict.kind === "single-zone-fallback" && probe.verdict.reason).toBe("paint-ignored");
    expect(probe.label).toBe(SINGLE_ZONE_BADGE);
    expect(fallbackOrder(probe.verdict)).toEqual(["lan-json-colorwc", "ble-single", "matter"]);

    // The probe did paint, and nothing changed: arm was accepted, the channel
    // reported armed, and the user still saw one colour.
    expect(probe.framesSentHex).toHaveLength(4);
    expect(probe.armedReadBack).toBe("armed");
    expect(lamp.painted).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(lamp.metrics.paintsIgnored).toBe(2);
    expect(lamp.metrics.paintsApplied).toBe(0);
  });

  it("flags a unit that answers no LAN at all, with the BLE alternative and no frames", async () => {
    const lamp = makeLamp("lan-absent");
    const probe = await probeSegmentedCapability(lamp, identity(), new ScriptedUser(lamp), options());

    expect(probe.verdict.kind).toBe("lan-unavailable");
    expect(probe.verdict.verified).toBe(false);
    expect(probe.verdict.kind === "lan-unavailable" && probe.verdict.badge).toBe(LAN_UNAVAILABLE_BADGE);
    expect(probe.verdict.kind === "lan-unavailable" && probe.verdict.bleAlternative).toBe("ble-segmented");
    expect(probe.verdict.kind === "lan-unavailable" && probe.verdict.troubleshooting).toHaveLength(LAN_TROUBLESHOOTING.length);
    expect(probe.label).toBe(LAN_UNAVAILABLE_BADGE);
    expect(probe.reachable).toBe(false);
    expect(fallbackOrder(probe.verdict)).toEqual(["ble-segmented", "ble-single", "matter"]);

    // Nothing was armed and nothing was painted: the probe does not pretend.
    expect(probe.framesSentHex).toEqual([]);
    expect(lamp.sentRaw).toHaveLength(0);
    expect(probe.commandsSent.filter((sent) => sent !== STATUS_COMMAND && sent !== DEV_STATUS_COMMAND)).toEqual([]);
    expect(probe.commandsSent.length).toBeGreaterThan(0);
  });

  it("records silence while armed without calling it a failure", async () => {
    const lamp = makeLamp("segmented", { answersStatusWhileArmed: false });
    const probe = await probeSegmentedCapability(lamp, identity(), new ScriptedUser(lamp), options());

    expect(probe.armedReadBack).toBe("silent");
    expect(probe.verdict.kind).toBe("segmented");
    expect(probe.b0Confirmed).toBe(true);
    // The B2 read-back while armed was resent until the deadline, then given up.
    expect(probe.commandsSent.filter((sent) => sent === STATUS_COMMAND).length).toBeGreaterThan(1);
  });

  it("treats a unit that answers outside the documented shape as reachable", async () => {
    const lamp = new FakeLamp({
      device: MAC,
      ip: "10.0.0.42",
      sku: SKU,
      firmware: FIRMWARE,
      zones: ZONES,
      behaviour: "segmented",
      armSettleMs: 5,
      garbageReplies: true,
    });
    const probe = await probeSegmentedCapability(lamp, identity(), new ScriptedUser(lamp), options());

    // A reply that does not parse is still a LAN channel: the paints decide.
    expect(probe.statusAnswered).toBe(true);
    expect(probe.reachable).toBe(true);
    expect(probe.armedReadBack).toBe("silent");
    expect(probe.verdict.kind).toBe("segmented");
  });
});

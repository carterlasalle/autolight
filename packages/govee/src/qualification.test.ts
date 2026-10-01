// T-GOV-11 wizard tests: the full 16-step spec 52 scripted-user run, per-step
// evidence persisted to the store, resume from the store, the changepoint
// sweep byte-exact, and the firmware-change rule (steps 8, 9, 12, 13 before
// segmented streaming resumes). P-52-wizard; the UI over the same state
// machine is T-UI-09.
import { describe, expect, it } from "vitest";
import {
  MemoryCalibrationStore,
  QUALIFICATION_STEP_COUNT,
  REQUIRED_AFTER_FIRMWARE_CHANGE,
  QualificationSession,
  firmwareFromScan,
  type QualificationOptions,
} from "./qualification.js";
import { recalibrate } from "./actions.js";
import { SINGLE_ZONE_BADGE } from "./probe.js";
import { FakeLamp, ScriptedUser, goldenHex } from "./lan-fake.test-support.js";

const MAC = "AA:BB:CC:DD:EE:07";
const OPCODE_B0 = 0xb0;
const OPCODE_ARM = 0xb1;
const FIRMWARE = "1.02.03";

function makeLamp(over: Partial<ConstructorParameters<typeof FakeLamp>[0]> = {}): FakeLamp {
  return new FakeLamp({
    device: MAC,
    ip: "10.0.0.77",
    sku: "H6076",
    firmware: FIRMWARE,
    zones: 4,
    behaviour: "segmented",
    // The unit needs 55 ms of settle; the sweep in step 12 is what discovers it.
    armSettleMs: 55,
    reconnectDelayMs: 20,
    ...over,
  });
}

function options(lamp: FakeLamp, store: MemoryCalibrationStore): QualificationOptions {
  return {
    exchange: lamp,
    discovery: lamp.scanReply(),
    store,
    zones: 4,
    // Above the unit's real settle (55 ms), so every step before step 12 can
    // paint without waiting for the sweep's answer.
    armSettleMs: 70,
    identifyFlashMs: 5,
    stepMs: 3,
    statusRetryMs: 5,
    statusDeadlineMs: 40,
    minSpacingMs: 0,
    armSettleSweepMaxMs: 200,
    armSettleSweepStepMs: 20,
    rateSweepHz: [60, 40, 25, 10],
    rateSweepTicks: 2,
    reconnectMaxMs: 300,
  };
}

function opsOf(lamp: FakeLamp, opcode: number): string[] {
  return lamp.sentRaw.filter((frame) => frame[3] === opcode).map((frame) => Buffer.from(frame).toString("hex"));
}

/** One zebra stripe payload: candidates are counted on what the unit renders. */
function stripePayload(zones: number): number[] {
  const payload = [0, zones];
  for (let zone = 0; zone < zones; zone++) {
    payload.push(...(zone % 2 === 0 ? [255, 0, 0] : [0, 0, 255]));
  }
  return payload;
}

interface StoredState {
  key: string;
  status: string;
  firmwareVersion: string;
  steps: { id: string; step: number; status: string; attempts: number; evidence: Record<string, unknown> }[];
  calibration: { segmentCount: number; maxStableFps: number; armSettleMs: number } | null;
}

function storedState(store: MemoryCalibrationStore): StoredState {
  // JSON.parse of the blob the wizard just wrote; the shape is ours.
  return JSON.parse(store.rows.get(MAC)?.calibrationJson ?? "{}") as StoredState;
}

describe("govee qualification wizard", () => {
  it("runs the 16 spec 52 steps in order with a scripted user and persists each step", async () => {
    const lamp = makeLamp();
    const store = new MemoryCalibrationStore();
    const session = QualificationSession.open(options(lamp, store));

    const state = await session.runAll(new ScriptedUser(lamp));

    expect(state.status).toBe("complete");
    expect(state.steps.map((step) => step.step)).toEqual(Array.from({ length: QUALIFICATION_STEP_COUNT }, (_, index) => index + 1));
    expect(state.steps.map((step) => step.status)).toEqual(Array.from({ length: QUALIFICATION_STEP_COUNT }, () => "pass"));
    expect(state.steps.every((step) => Object.keys(step.evidence).length > 0)).toBe(true);
    expect(state.calibration).not.toBeNull();
    expect(state.calibration?.segmentCount).toBe(4);
    expect(state.calibration?.armSettleMs).toBe(60);
    expect(state.calibration?.maxStableFps).toBe(60);
    expect(state.calibration?.expectedLatencyMs).toBe(25);
    expect(state.calibration?.latencyMethod).toBe("camera");
    expect(state.calibration?.orientation).toBe("forward");
    expect(state.calibration?.unmeasured).toEqual([]);
    expect(state.calibration?.capability.kind).toBe("segmented");
    expect(session.segmentedResumeAllowed()).toBe(true);

    // What the store holds: the same step table, keyed by hardware ID + SKU +
    // firmware (spec 52).
    const saved = storedState(store);
    expect(saved.key).toBe(`${MAC}+H6076+${FIRMWARE}`);
    expect(saved.status).toBe("complete");
    expect(saved.steps).toHaveLength(QUALIFICATION_STEP_COUNT);
    expect(saved.steps.every((step) => step.status === "pass")).toBe(true);
    expect(saved.steps.find((step) => step.id === "segment-count")?.evidence["logicalSegmentCount"]).toBe(4);
    expect(saved.calibration?.segmentCount).toBe(4);

    // The unit was powered, read back, armed and painted; reconnect measured.
    expect(lamp.metrics.powerCycles).toBe(1);
    expect(lamp.metrics.paintsApplied).toBeGreaterThan(0);
  });

  it("stops at step 8 when the unit ignores paint and keeps the visible fallback", async () => {
    const lamp = makeLamp({ behaviour: "ignores-paints", answersStatusWhileArmed: true });
    const store = new MemoryCalibrationStore();
    const session = QualificationSession.open(options(lamp, store));

    const state = await session.runAll(new ScriptedUser(lamp));

    expect(state.status).toBe("in-progress");
    expect(state.calibration).toBeNull();
    const failed = state.steps.find((step) => step.id === "verify-stream");
    expect(failed?.status).toBe("fail");
    expect(failed?.evidence["label"]).toBe(SINGLE_ZONE_BADGE);
    expect(failed?.evidence["reason"]).toContain(SINGLE_ZONE_BADGE);
    // Every earlier step still passed: the device keeps its verified
    // whole-fixture mode, and the record says which step stopped.
    expect(state.steps.filter((step) => step.status === "pass").map((step) => step.id)).toEqual([
      "discover",
      "identify",
      "read-sku",
      "read-firmware",
      "verify-power",
      "verify-brightness",
      "verify-rgb",
    ]);
    expect(state.currentStep).toBe(8);
    expect(session.segmentedResumeAllowed()).toBe(false);
    expect(lamp.metrics.paintsIgnored).toBe(2);
  });

  it("marks REQUALIFICATION REQUIRED after a firmware change and gates segmented streaming", async () => {
    const lamp = makeLamp();
    const store = new MemoryCalibrationStore();
    const session = QualificationSession.open(options(lamp, store));
    await session.runAll(new ScriptedUser(lamp));
    expect(session.segmentedResumeAllowed()).toBe(true);

    const change = session.noteFirmware("1.03.00");
    expect(change.changed).toBe(true);
    expect(change.required).toEqual(REQUIRED_AFTER_FIRMWARE_CHANGE);
    expect(session.state.status).toBe("requalification-required");
    expect(session.state.key).toBe(`${MAC}+H6076+1.03.00`);
    expect(session.segmentedResumeAllowed()).toBe(false);
    expect(session.nextStep()).toBe(8);
    expect(session.state.steps.filter((step) => step.status === "pending").map((step) => step.id)).toEqual([
      ...REQUIRED_AFTER_FIRMWARE_CHANGE,
    ]);
    // The earlier evidence is kept as history, not thrown away.
    expect(session.record("verify-stream")?.attempts).toBe(1);
    expect(session.record("verify-stream")?.priorEvidence).toHaveLength(1);

    const resumed = await session.runAll(new ScriptedUser(lamp));
    expect(resumed.status).toBe("complete");
    expect(session.segmentedResumeAllowed()).toBe(true);
    expect(session.record("verify-stream")?.attempts).toBe(2);
    expect(session.record("arm-settle")?.attempts).toBe(2);
    expect(session.record("segment-count")?.attempts).toBe(2);
    expect(session.record("stable-rate")?.attempts).toBe(2);
  });

  it("resumes from the store and recognises a firmware change when it opens", async () => {
    const lamp = makeLamp();
    const store = new MemoryCalibrationStore();
    const first = QualificationSession.open(options(lamp, store));
    await first.runAll(new ScriptedUser(lamp));
    expect(storedState(store).status).toBe("complete");

    const reopened = QualificationSession.open(options(lamp, store));
    expect(reopened.state.status).toBe("complete");
    expect(reopened.state.steps.every((step) => step.status === "pass")).toBe(true);
    expect(reopened.segmentedResumeAllowed()).toBe(true);

    // Same hardware ID, new firmware: opening the stored record is a firmware
    // change, so the wizard demands the four essential steps again.
    const updated = makeLamp({ firmware: "1.03.00" });
    const reopenedUpdated = QualificationSession.open(options(updated, store));
    expect(reopenedUpdated.state.status).toBe("requalification-required");
    expect(reopenedUpdated.state.firmwareVersion).toBe("1.03.00");
    expect(reopenedUpdated.nextStep()).toBe(8);
    expect(reopenedUpdated.segmentedResumeAllowed()).toBe(false);
  });

  it("sweeps candidate band counts, stops at the changepoint, and paints byte exact", async () => {
    const lamp = makeLamp();
    const store = new MemoryCalibrationStore();
    const session = QualificationSession.open(options(lamp, store));
    const user = new ScriptedUser(lamp);
    for (let step = 0; step < 9; step++) await session.runStep(user);

    const recorded = session.record("segment-count");
    expect(recorded?.status).toBe("pass");
    expect(recorded?.evidence["sweep"]).toEqual([
      { candidate: 2, confirmed: true },
      { candidate: 4, confirmed: true },
      { candidate: 6, confirmed: false },
    ]);
    expect(recorded?.evidence["logicalSegmentCount"]).toBe(4);
    expect(recorded?.evidence["nativeSegmentCount"]).toBe(4);
    expect(recorded?.evidence["changepoint"]).toBe(6);

    // B0 frames in order: the step 8 two-colour probe paint, then the stripe
    // paints for candidates 2, 4 and 6 (the unit renders 4 zones, so 6 does not
    // appear and the sweep stops there).
    const b0 = opsOf(lamp, OPCODE_B0);
    expect(b0).toEqual([
      goldenHex(OPCODE_B0, [0, 4, 255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255]),
      goldenHex(OPCODE_B0, stripePayload(2)),
      goldenHex(OPCODE_B0, stripePayload(4)),
      goldenHex(OPCODE_B0, stripePayload(6)),
    ]);
    expect(opsOf(lamp, OPCODE_ARM)).toContain(goldenHex(OPCODE_ARM, [1]));
    expect(opsOf(lamp, OPCODE_ARM)).toContain(goldenHex(OPCODE_ARM, [0]));
  });

  it("recalibrate at a step resumes there and keeps the earlier evidence", async () => {
    const lamp = makeLamp();
    const store = new MemoryCalibrationStore();
    const session = QualificationSession.open(options(lamp, store));
    await session.runAll(new ScriptedUser(lamp));

    const result = recalibrate(session, 13);
    expect(result.step).toBe(13);
    expect(result.stepId).toBe("stable-rate");
    expect(session.nextStep()).toBe(13);
    expect(session.state.status).toBe("in-progress");
    // Steps 1 to 12 keep their verdicts; 13 to 16 go back to pending.
    expect(session.state.steps.filter((step) => step.status === "pass").map((step) => step.step)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(session.record("stable-rate")?.priorEvidence).toHaveLength(1);
    expect(session.segmentedResumeAllowed()).toBe(false);

    const resumed = await session.runAll(new ScriptedUser(lamp));
    expect(resumed.status).toBe("complete");
    expect(session.record("stable-rate")?.attempts).toBe(2);
    expect(session.record("verify-stream")?.attempts).toBe(1);
  });

  it("restarts at step 1 when the stored record has the wrong shape", () => {
    const lamp = makeLamp();
    const store = new MemoryCalibrationStore();
    store.save(MAC, "H6076", FIRMWARE, JSON.stringify({ hardwareId: "AA:BB:CC:DD:EE:99", steps: [] }));

    const session = QualificationSession.open(options(lamp, store));
    expect(session.state.loadNote).toContain("restarted at step 1");
    expect(session.nextStep()).toBe(1);
    expect(session.state.steps).toHaveLength(QUALIFICATION_STEP_COUNT);
    expect(session.state.steps.every((step) => step.status === "pending")).toBe(true);
  });

  it("reads the firmware key fields from the scan reply", () => {
    const lamp = makeLamp();
    expect(firmwareFromScan(lamp.scanReply())).toBe(FIRMWARE);
    expect(firmwareFromScan({ ...lamp.scanReply(), wifiVersionSoft: "", wifiVersionHard: "" })).toBe("1.03.01");
    expect(firmwareFromScan({
      ...lamp.scanReply(),
      wifiVersionSoft: "",
      wifiVersionHard: "",
      bleVersionSoft: "",
      bleVersionHard: "",
    })).toBe("unmeasured");
  });
});

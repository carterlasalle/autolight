// Qualification wizard runner (T-GOV-11, closes F-GOV-11, F-GOV-12, F-GOV-22,
// F-GOV-24, F-X-07; spec 52, 53, 54).
//
// All 16 steps of spec 52 run as one resumable state machine. Every step
// records its own evidence, and the whole record is persisted after each step
// (the repo schema stores it in the `devices` row's calibration JSON, the
// `device_calibrations` record of T-GOV-06 keyed by hardware ID plus SKU plus
// firmware). A firmware change marks REQUALIFICATION REQUIRED: normal control
// continues on the last verified capability (spec 147) and steps 8, 9, 12 and
// 13 must pass again before segmented streaming resumes.
//
// Nothing here is a SKU assumption (spec 42): the segment count comes from the
// user counting distinct bands in a stripe pattern plus the changepoint sweep
// of lan.md 2.3, the rate table comes from the rate sweep, and every number the
// UI shows comes from this record or says "unmeasured".
//
// Provenance: govee-toolkit MIT (Damien Thery, v0.5.0) docs/protocol/lan.md
// sections 2.1 to 2.3 (arm, B0, B4), 2.3 (native resolution changepoint sweep)
// and section 1 (arm settle, consecutive commands); spec 42 to 43 for the two
// owner SKUs; T-QA-08 for the camera latency procedure.
import {
  PacingStream,
  WALL_SCHEDULER,
  arm,
  brightnessCommand,
  colorCommand,
  paint,
  turnCommand,
  type Scheduler,
  type ScanReply,
} from "./razer.js";
import { whiteHitPayload } from "./index.js";
import {
  CommandSequencer,
  DeviceLink,
  PROBE_DEFAULTS,
  probeSegmentedCapability,
  readDevStatus,
  sleep,
  type CapabilityProbe,
  type LanExchange,
  type ProbeOptions,
  type ProbeUser,
  type Waiter,
} from "./probe.js";
import { chaseFrames, identify, type ActionFixture } from "./actions.js";

/** Spec 52, in order. `spec` is the step number inside spec 52, never a zone
 *  or segment count: segment counts are measured per unit and no literal count
 *  appears in this package (spec 42). */
export const QUALIFICATION_STEPS = [
  { id: "discover", spec: 1, title: "discover" },
  { id: "identify", spec: 2, title: "identify (flash and user confirm)" },
  { id: "read-sku", spec: 3, title: "read SKU" },
  { id: "read-firmware", spec: 4, title: "read firmware (scan reply fields)" },
  { id: "verify-power", spec: 5, title: "verify power (read-back)" },
  { id: "verify-brightness", spec: 6, title: "verify global brightness (read-back)" },
  { id: "verify-rgb", spec: 7, title: "verify RGB (read-back)" },
  { id: "verify-stream", spec: 8, title: "verify local RGBIC stream (capability probe)" },
  { id: "segment-count", spec: 9, title: "logical segment count (stripe count and changepoint sweep)" },
  { id: "segment-order", spec: 10, title: "segment order (single moving zone)" },
  { id: "orientation", spec: 11, title: "reverse orientation" },
  { id: "arm-settle", spec: 12, title: "arm settle (sweep 0 to 200 ms)" },
  { id: "stable-rate", spec: 13, title: "stable output frequency (rate sweep)" },
  { id: "visual-latency", spec: 14, title: "visual latency (camera or guided tap)" },
  { id: "reconnect", spec: 15, title: "reconnect (user power-cycles the unit)" },
  { id: "save", spec: 16, title: "save calibration (hardware ID plus SKU plus firmware)" },
] as const;

export type QualificationStepId = (typeof QUALIFICATION_STEPS)[number]["id"];

export const QUALIFICATION_STEP_COUNT = QUALIFICATION_STEPS.length;

/** Spec 52: after a firmware change these four must pass before the segmented
 *  channel streams again (steps 8, 9, 12, 13). */
export const REQUIRED_AFTER_FIRMWARE_CHANGE: readonly QualificationStepId[] = [
  "verify-stream",
  "segment-count",
  "arm-settle",
  "stable-rate",
];

/** Candidate counts the user counts bands for (spec 42: discovered, never
 *  assumed). The sweep stops at the first count that does not appear, so the
 *  largest confirmed count is the changepoint. */
export const SEGMENT_CANDIDATES: readonly number[] = [2, 4, 6, 8, 12, 16, 20, 30, 40, 60];

/** Descending rate sweep for step 13; the first rate that does not stutter is
 *  the unit's stable rate (spec 54 `maxStableFps`). */
export const RATE_SWEEP_HZ: readonly number[] = [60, 50, 40, 30, 25, 20, 15, 10];

export interface QualificationAttempt {
  step: number;
  id: QualificationStepId;
  title: string;
  status: "pending" | "pass" | "fail";
  attempts: number;
  evidence: Record<string, unknown>;
  /** Evidence of earlier attempts at this step, newest last (bounded). */
  priorEvidence: string[];
  atMs: number | null;
}

/** One unit's whole qualification record. Persisted as JSON. */
export interface QualificationState {
  key: string;
  hardwareId: string;
  sku: string;
  firmwareVersion: string;
  status: "in-progress" | "complete" | "requalification-required";
  /** 1-based; points at the next step to run. */
  currentStep: number;
  steps: QualificationAttempt[];
  calibration: CalibrationRecord | null;
  requiredAfterFirmwareChange: readonly QualificationStepId[];
  /** Set when a stored record could not be read back, so the UI can say why. */
  loadNote: string | null;
  updatedAtMs: number;
}

/** Spec 54 record plus the honesty fields: anything the wizard could not
 *  measure is listed in `unmeasured` instead of being filled with a number. */
export interface CalibrationRecord {
  key: string;
  hardwareId: string;
  sku: string;
  firmwareVersion: string;
  segmentCount: number;
  logicalSegmentCount: number;
  nativeSegmentCount: number;
  maxStableFps: number;
  expectedLatencyMs: number;
  latencyMethod: "camera" | "tap" | "unmeasured";
  armSettleMs: number;
  orientation: "forward" | "reverse";
  gamma: number;
  brightnessCeiling: number;
  unmeasured: string[];
  capability: CapabilityProbe["verdict"];
  /** T-GOV-15 owns the logical/grouped/native choice; this only records that
   *  the wizard did not make it. */
  resolutionSelection: string;
  steps: QualificationAttempt[];
  savedAtMs: number;
}

/** The repo store's calibration shape (@autolight/storage `Store`). */
export interface CalibrationStore {
  save(hardwareId: string, sku: string, firmware: string, calibrationJson: string): void;
  load(hardwareId: string): { sku: string; firmware: string; calibrationJson: string | null } | null;
}

/** The user side of the wizard. The UI (T-UI-09) implements this; the SIM test
 *  scripts it. Camera steps answer from what the unit actually rendered, the
 *  rest are confirmations. */
export interface QualificationUser extends ProbeUser {
  confirmIdentify(): Promise<boolean>;
  seesDistinctBands(candidateZones: number): Promise<boolean>;
  whichEndFirst(): Promise<"index-zero" | "index-last" | "unclear">;
  chooseOrientation(): Promise<"forward" | "reverse">;
  confirmPaintLanded(delayMs: number): Promise<boolean>;
  markStutter(rateHz: number): Promise<boolean>;
  measureLatencyMs(): Promise<{ valueMs: number; method: "camera" | "tap" } | null>;
  powerCycled(): Promise<void>;
}

export interface QualificationOptions {
  exchange: LanExchange;
  /** The discovery reply for this unit (T-GOV-05 owns the ladder that found
   *  it); `device` is the MAC used as the device id everywhere. */
  discovery: ScanReply;
  store: CalibrationStore;
  /** Candidate zone count for the step 8 stripe paint; not an assumption. */
  zones?: number;
  armSettleMs?: number;
  statusRetryMs?: number;
  statusDeadlineMs?: number;
  minSpacingMs?: number;
  identifyFlashMs?: number;
  stepMs?: number;
  segmentCandidates?: readonly number[];
  armSettleSweepMaxMs?: number;
  armSettleSweepStepMs?: number;
  rateSweepHz?: readonly number[];
  rateSweepTicks?: number;
  reconnectMaxMs?: number;
  brightnessProbe?: number;
  gamma?: number;
  brightnessCeiling?: number;
  scheduler?: Scheduler;
  wait?: Waiter;
  clock?: () => number;
}

/** Step 3 to 4: the scan reply is the only place SKU and firmware come from
 *  (T-GOV-05 validates the reply). "unmeasured" is a value, not a gap: the
 *  calibration key then records that the firmware could not be read. */
export function firmwareFromScan(scan: ScanReply): string {
  const candidates = [scan.wifiVersionSoft, scan.wifiVersionHard, scan.bleVersionSoft, scan.bleVersionHard];
  for (const value of candidates) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "unmeasured";
}

/** Zebra stripes: adjacent zones alternate red and blue, so a user (or a
 *  camera) can count distinct bands in the pattern they were asked to paint. */
export function stripeFrame(zones: number): Uint8Array {
  const n = Math.max(1, Math.floor(zones));
  const frame = new Uint8Array(n * 3);
  for (let zone = 0; zone < n; zone++) {
    const even = zone % 2 === 0;
    frame[zone * 3] = even ? 255 : 0;
    frame[zone * 3 + 1] = 0;
    frame[zone * 3 + 2] = even ? 0 : 255;
  }
  return frame;
}

interface StepOutcome {
  status: "pass" | "fail";
  evidence: Record<string, unknown>;
}

/**
 * One wizard for one unit. `open()` resumes whatever the store has for that
 * hardware ID, so the UI can stop and come back at any step; `runStep()` runs
 * exactly one step and persists it; `runAll()` drives the whole sequence.
 */
export class QualificationSession {
  private readonly options: QualificationOptions;
  private readonly stateValue: QualificationState;
  private readonly wait: Waiter;
  private readonly link: DeviceLink;

  private constructor(options: QualificationOptions, state: QualificationState, note: string | null) {
    this.options = options;
    this.stateValue = state;
    this.wait = options.wait ?? sleep;
    this.link = new DeviceLink(
      options.exchange,
      state.hardwareId,
      new CommandSequencer({
        minSpacingMs: options.minSpacingMs ?? PROBE_DEFAULTS.minSpacingMs,
        ...(options.wait !== undefined ? { wait: options.wait } : {}),
        ...(options.clock !== undefined ? { clock: options.clock } : {}),
      }),
    );
    if (note !== null) this.stateValue.loadNote = note;
    this.applyDiscovery();
  }

  static open(options: QualificationOptions): QualificationSession {
    const hardwareId = options.discovery.device;
    const saved = options.store.load(hardwareId);
    if (saved?.calibrationJson) {
      try {
        // The blob this class wrote. Validate the two things a corrupted or
        // older record would get wrong before trusting the rest.
        const parsed = JSON.parse(saved.calibrationJson) as QualificationState;
        if (parsed.hardwareId !== hardwareId || !Array.isArray(parsed.steps) || parsed.steps.length !== QUALIFICATION_STEP_COUNT) {
          return new QualificationSession(
            options,
            freshState(hardwareId, options.discovery.sku, firmwareFromScan(options.discovery)),
            "the stored record does not match this wizard's shape (hardware id or step table); the wizard restarted at step 1",
          );
        }
        return new QualificationSession(options, parsed, null);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return new QualificationSession(
          options,
          freshState(hardwareId, options.discovery.sku, firmwareFromScan(options.discovery)),
          `the stored record could not be read (${detail}); the wizard restarted at step 1`,
        );
      }
    }
    return new QualificationSession(
      options,
      freshState(hardwareId, options.discovery.sku, firmwareFromScan(options.discovery)),
      null,
    );
  }

  get state(): QualificationState {
    return this.stateValue;
  }

  get hardwareId(): string {
    return this.stateValue.hardwareId;
  }

  record(id: QualificationStepId): QualificationAttempt | undefined {
    return this.stateValue.steps.find((step) => step.id === id);
  }

  /** 1-based next step to run (clamped to the last step once every step is
   *  done). */
  nextStep(): number {
    return Math.min(this.stateValue.currentStep, QUALIFICATION_STEP_COUNT);
  }

  /**
   * RECALIBRATE target (T-GOV-12): open the wizard at a chosen step. That step
   * and every step after it go back to pending; earlier evidence is kept in
   * `priorEvidence` so the record still shows what was measured before.
   */
  enterAt(step: number): { step: number; stepId: QualificationStepId } {
    const target = Math.min(Math.max(1, Math.floor(step)), QUALIFICATION_STEP_COUNT);
    for (const attempt of this.stateValue.steps) {
      if (attempt.step < target) continue;
      if (Object.keys(attempt.evidence).length > 0) {
        attempt.priorEvidence = [...attempt.priorEvidence, JSON.stringify(attempt.evidence)].slice(-4);
      }
      attempt.status = "pending";
      attempt.evidence = {};
      attempt.atMs = null;
    }
    this.stateValue.status = "in-progress";
    this.stateValue.currentStep = target;
    // The last saved calibration stays in place for the UI while the user
    // re-runs steps; step 16 replaces it with the freshly measured record.
    this.persist();
    return { step: target, stepId: stepIdAt(target) };
  }

  /**
   * Firmware change (spec 52): mark REQUALIFICATION REQUIRED and put steps 8,
   * 9, 12 and 13 back to pending. Normal control continues on the last
   * verified capability while they are pending; segmented streaming does not.
   */
  noteFirmware(firmware: string): {
    changed: boolean;
    required: readonly QualificationStepId[];
    state: QualificationState;
  } {
    const changed = firmware !== this.stateValue.firmwareVersion;
    if (!changed) return { changed: false, required: [], state: this.stateValue };
    this.stateValue.firmwareVersion = firmware;
    this.stateValue.key = `${this.stateValue.hardwareId}+${this.stateValue.sku}+${firmware}`;
    this.stateValue.status = "requalification-required";
    this.stateValue.requiredAfterFirmwareChange = REQUIRED_AFTER_FIRMWARE_CHANGE;
    for (const id of REQUIRED_AFTER_FIRMWARE_CHANGE) {
      this.resetStep(id);
    }
    const first = this.record(REQUIRED_AFTER_FIRMWARE_CHANGE[0] ?? "verify-stream");
    this.stateValue.currentStep = first?.step ?? this.stateValue.currentStep;
    this.persist();
    return { changed: true, required: REQUIRED_AFTER_FIRMWARE_CHANGE, state: this.stateValue };
  }

  /** True when the segmented channel may stream: either qualification
   *  completed, or every step required after a firmware change has passed
   *  again. */
  segmentedResumeAllowed(): boolean {
    if (this.stateValue.status === "complete") return true;
    return REQUIRED_AFTER_FIRMWARE_CHANGE.every((id) => this.record(id)?.status === "pass");
  }

  /** Runs the step at `currentStep` and persists it. */
  async runStep(user: QualificationUser): Promise<QualificationAttempt> {
    const step = this.nextStep();
    const def = stepAt(step);
    const outcome = await this.execute(def.id, user);
    const attempt = this.record(def.id);
    if (attempt === undefined) throw new Error(`qualification step ${def.id} is not in the record`);
    attempt.attempts += 1;
    attempt.status = outcome.status;
    attempt.evidence = outcome.evidence;
    attempt.atMs = this.now();
    if (outcome.status === "pass") {
      this.stateValue.currentStep = Math.min(def.spec + 1, QUALIFICATION_STEP_COUNT);
    }
    if (def.id === "save" && this.stateValue.calibration !== null) {
      // The saved record carries the step table as it stands, step 16 included.
      this.stateValue.calibration.steps = this.stateValue.steps;
    }
    if (this.stateValue.steps.every((entry) => entry.status === "pass")) {
      this.stateValue.status = "complete";
    }
    this.persist();
    return attempt;
  }

  /** Runs until the record completes or a step fails. A failing step stops the
   *  run: the device keeps its visible fallback and the record says why. */
  async runAll(user: QualificationUser): Promise<QualificationState> {
    let guard = 0;
    const limit = QUALIFICATION_STEP_COUNT * 2;
    while (this.stateValue.status !== "complete" && guard < limit) {
      guard += 1;
      const attempt = await this.runStep(user);
      if (attempt.status === "fail") break;
    }
    return this.stateValue;
  }

  private now(): number {
    return this.options.clock?.() ?? Date.now();
  }

  private persist(): void {
    this.stateValue.updatedAtMs = this.now();
    this.options.store.save(
      this.stateValue.hardwareId,
      this.stateValue.sku,
      this.stateValue.firmwareVersion,
      JSON.stringify(this.stateValue),
    );
  }

  private resetStep(id: QualificationStepId): void {
    const attempt = this.record(id);
    if (attempt === undefined) return;
    if (Object.keys(attempt.evidence).length > 0) {
      attempt.priorEvidence = [...attempt.priorEvidence, JSON.stringify(attempt.evidence)].slice(-4);
    }
    attempt.status = "pending";
    attempt.evidence = {};
    attempt.atMs = null;
  }

  private applyDiscovery(): void {
    if (this.options.discovery.sku.length > 0 && this.stateValue.sku.length === 0) {
      this.stateValue.sku = this.options.discovery.sku;
      this.stateValue.key = `${this.stateValue.hardwareId}+${this.stateValue.sku}+${this.stateValue.firmwareVersion}`;
    }
    const firmware = firmwareFromScan(this.options.discovery);
    // A stored record for another firmware is a firmware change: REQUALIFY.
    if (firmware !== this.stateValue.firmwareVersion && this.stateValue.steps.some((step) => step.status === "pass")) {
      this.noteFirmware(firmware);
    }
  }

  private numberFrom(id: QualificationStepId, key: string): number | null {
    const value = this.record(id)?.evidence[key];
    return typeof value === "number" ? value : null;
  }

  private stringFrom(id: QualificationStepId, key: string): string | null {
    const value = this.record(id)?.evidence[key];
    return typeof value === "string" ? value : null;
  }

  private readbackOpts(): { retryMs: number; deadlineMs: number; wait: Waiter } {
    return {
      retryMs: this.options.statusRetryMs ?? PROBE_DEFAULTS.statusRetryMs,
      deadlineMs: this.options.statusDeadlineMs ?? PROBE_DEFAULTS.statusDeadlineMs,
      wait: this.wait,
    };
  }

  private armSettle(): number {
    return this.options.armSettleMs ?? PROBE_DEFAULTS.armSettleMs;
  }

  /** The qualified zone count: step 9's answer, else the candidate. */
  private zones(): number {
    const counted = this.numberFrom("segment-count", "logicalSegmentCount");
    return Math.max(1, Math.floor(counted ?? this.options.zones ?? 8));
  }

  private execute(id: QualificationStepId, user: QualificationUser): Promise<StepOutcome> {
    switch (id) {
      case "discover":
        return this.stepDiscover();
      case "identify":
        return this.stepIdentify(user);
      case "read-sku":
        return this.stepReadSku();
      case "read-firmware":
        return this.stepReadFirmware();
      case "verify-power":
        return this.stepVerifyPower();
      case "verify-brightness":
        return this.stepVerifyBrightness();
      case "verify-rgb":
        return this.stepVerifyRgb();
      case "verify-stream":
        return this.stepVerifyStream(user);
      case "segment-count":
        return this.stepSegmentCount(user);
      case "segment-order":
        return this.stepSegmentOrder(user);
      case "orientation":
        return this.stepOrientation(user);
      case "arm-settle":
        return this.stepArmSettle(user);
      case "stable-rate":
        return this.stepStableRate(user);
      case "visual-latency":
        return this.stepVisualLatency(user);
      case "reconnect":
        return this.stepReconnect(user);
      case "save":
        return this.stepSave();
    }
  }

  private async stepDiscover(): Promise<StepOutcome> {
    const scan = this.options.discovery;
    const evidence: Record<string, unknown> = {
      device: scan.device,
      ip: scan.ip,
      sku: scan.sku,
      wifiVersionHard: scan.wifiVersionHard,
      wifiVersionSoft: scan.wifiVersionSoft,
      bleVersionHard: scan.bleVersionHard,
      bleVersionSoft: scan.bleVersionSoft,
      rung: "caller-provided (T-GOV-05 owns the discovery ladder)",
    };
    const ok = scan.device.length > 0 && scan.sku.length > 0;
    return { status: ok ? "pass" : "fail", evidence: { ...evidence, reason: ok ? null : "the scan reply has no device id or SKU" } };
  }

  private async stepIdentify(user: QualificationUser): Promise<StepOutcome> {
    const fixture: ActionFixture = {
      hardwareId: this.stateValue.hardwareId,
      zones: 1,
      capability: "single-zone",
      orientation: "forward",
      armed: false,
    };
    const options = {
      flashMs: this.options.identifyFlashMs ?? 1000,
      minSpacingMs: this.options.minSpacingMs ?? PROBE_DEFAULTS.minSpacingMs,
      ...(this.options.wait !== undefined ? { wait: this.options.wait } : {}),
    };
    const result = await identify(this.options.exchange, fixture, options);
    const confirmed = await user.confirmIdentify();
    return {
      status: confirmed ? "pass" : "fail",
      evidence: {
        confirmed,
        path: result.path,
        restored: result.restored,
        observedAnswered: result.observedAnswered,
        framesSentHex: result.framesSentHex,
        commandsSent: result.commandsSent,
      },
    };
  }

  private async stepReadSku(): Promise<StepOutcome> {
    const sku = this.options.discovery.sku;
    const ok = sku.length > 0;
    return {
      status: ok ? "pass" : "fail",
      evidence: { sku, source: "scan reply field", reason: ok ? null : "the scan reply carries no SKU" },
    };
  }

  private async stepReadFirmware(): Promise<StepOutcome> {
    const scan = this.options.discovery;
    const firmware = firmwareFromScan(scan);
    const measured = firmware !== "unmeasured";
    return {
      status: "pass",
      evidence: {
        firmware,
        measured,
        wifiVersionHard: scan.wifiVersionHard,
        wifiVersionSoft: scan.wifiVersionSoft,
        bleVersionHard: scan.bleVersionHard,
        bleVersionSoft: scan.bleVersionSoft,
        reason: measured ? null : "the scan reply carries no version field; the calibration key records an unmeasured firmware (spec 147)",
      },
    };
  }

  private async stepVerifyPower(): Promise<StepOutcome> {
    await this.link.sendJson(turnCommand(true));
    const read = await readDevStatus(this.link, this.readbackOpts());
    const observed = read.status?.onOff ?? null;
    const ok = observed === true;
    return {
      status: ok ? "pass" : "fail",
      evidence: {
        requested: true,
        observed,
        answered: read.answered,
        rttMs: read.rttMs,
        reason: ok ? null : "no devStatus read-back confirming power",
      },
    };
  }

  private async stepVerifyBrightness(): Promise<StepOutcome> {
    const requested = Math.min(100, Math.max(1, Math.round(this.options.brightnessProbe ?? 50)));
    await this.link.sendJson(brightnessCommand(requested));
    const read = await readDevStatus(this.link, this.readbackOpts());
    const observed = read.status?.brightness ?? null;
    const ok = observed === requested;
    return {
      status: ok ? "pass" : "fail",
      evidence: { requested, observed, answered: read.answered, rttMs: read.rttMs, reason: ok ? null : "brightness read-back does not match the request" },
    };
  }

  private async stepVerifyRgb(): Promise<StepOutcome> {
    const requested = { r: 255, g: 0, b: 0 };
    await this.link.sendJson(colorCommand(requested.r, requested.g, requested.b));
    const read = await readDevStatus(this.link, this.readbackOpts());
    const observed = read.status ?? null;
    const ok = observed !== null && observed.color.r === requested.r && observed.color.g === requested.g
      && observed.color.b === requested.b && observed.colorTemInKelvin === 0;
    return {
      status: ok ? "pass" : "fail",
      evidence: {
        requested,
        observed: observed === null ? null : { ...observed.color, colorTemInKelvin: observed.colorTemInKelvin },
        answered: read.answered,
        rttMs: read.rttMs,
        reason: ok ? null : "rgb read-back does not match, or the unit answered in a colour-temperature mode (spec 48)",
      },
    };
  }

  private async stepVerifyStream(user: QualificationUser): Promise<StepOutcome> {
    const probeOptions: ProbeOptions = {
      zones: this.options.zones ?? 8,
      armSettleMs: this.armSettle(),
      minSpacingMs: this.options.minSpacingMs ?? PROBE_DEFAULTS.minSpacingMs,
      ...this.readbackOpts(),
      ...(this.options.wait !== undefined ? { wait: this.options.wait } : {}),
      ...(this.options.clock !== undefined ? { clock: this.options.clock } : {}),
    };
    const probe = await probeSegmentedCapability(
      this.options.exchange,
      {
        hardwareId: this.stateValue.hardwareId,
        sku: this.stateValue.sku,
        firmwareVersion: this.stateValue.firmwareVersion,
        ip: this.options.discovery.ip,
      },
      user,
      probeOptions,
    );
    const ok = probe.verdict.kind === "segmented";
    return {
      status: ok ? "pass" : "fail",
      evidence: {
        ...probe,
        reason: ok ? null : `the segmented channel is not verified: this unit shows ${probe.label}`,
      },
    };
  }

  private async stepSegmentCount(user: QualificationUser): Promise<StepOutcome> {
    const candidates = this.options.segmentCandidates ?? SEGMENT_CANDIDATES;
    await this.link.sendRaw(arm(true));
    await this.wait(this.armSettle());
    const sweep: { candidate: number; confirmed: boolean }[] = [];
    let logical = 0;
    for (const candidate of candidates) {
      await this.link.sendRaw(paint(stripeFrame(candidate)));
      const confirmed = await user.seesDistinctBands(candidate);
      sweep.push({ candidate, confirmed });
      if (!confirmed) break;
      logical = candidate;
    }
    await this.link.sendRaw(arm(false));
    const firstMiss = sweep.find((entry) => !entry.confirmed);
    const ok = logical > 0;
    return {
      status: ok ? "pass" : "fail",
      evidence: {
        candidates,
        sweep,
        logicalSegmentCount: logical,
        nativeSegmentCount: logical,
        changepoint: firstMiss?.candidate ?? null,
        method: "user counts distinct bands in a stripe pattern; the sweep stops at the changepoint (lan.md 2.3)",
        resolutionSelection: "T-GOV-15 owns logical/grouped/native selection from this record",
        reason: ok ? null : "no candidate count was confirmed: the unit renders a single colour",
      },
    };
  }

  private async stepSegmentOrder(user: QualificationUser): Promise<StepOutcome> {
    const zones = this.zones();
    const stepMs = this.options.stepMs ?? 150;
    await this.link.sendRaw(arm(true));
    await this.wait(this.armSettle());
    await this.link.sendRaw(paint(oneZoneFrame(zones, 0)));
    await this.wait(stepMs);
    await this.link.sendRaw(paint(oneZoneFrame(zones, zones - 1)));
    await this.wait(stepMs);
    const answer = await user.whichEndFirst();
    await this.link.sendRaw(arm(false));
    const ok = answer !== "unclear";
    return {
      status: ok ? "pass" : "fail",
      evidence: {
        firstZone: 0,
        secondZone: zones - 1,
        stepMs,
        answer,
        reason: ok ? null : "the user could not tell which end lit first",
      },
    };
  }

  private async stepOrientation(user: QualificationUser): Promise<StepOutcome> {
    const orientation = await user.chooseOrientation();
    return { status: "pass", evidence: { orientation, method: "user choice after the single moving zone" } };
  }

  private async stepArmSettle(user: QualificationUser): Promise<StepOutcome> {
    const zones = this.zones();
    const maxDelay = Math.max(0, this.options.armSettleSweepMaxMs ?? 200);
    const stepDelay = Math.max(1, this.options.armSettleSweepStepMs ?? 20);
    const attempts: { delayMs: number; landed: boolean }[] = [];
    let settle: number | null = null;
    for (let delay = 0; delay <= maxDelay; delay += stepDelay) {
      await this.link.sendRaw(arm(false));
      await this.wait(stepDelay);
      await this.link.sendRaw(arm(true));
      await this.wait(delay);
      await this.link.sendRaw(paint(whiteHitPayload(zones, 1)));
      const landed = await user.confirmPaintLanded(delay);
      attempts.push({ delayMs: delay, landed });
      if (landed) {
        settle = delay;
        break;
      }
    }
    await this.link.sendRaw(arm(false));
    const ok = settle !== null;
    return {
      status: ok ? "pass" : "fail",
      evidence: {
        attempts,
        settleMs: settle,
        sweepMaxMs: maxDelay,
        sweepStepMs: stepDelay,
        reason: ok ? null : `no sweep delay up to ${maxDelay} ms landed a paint`,
      },
    };
  }

  private async stepStableRate(user: QualificationUser): Promise<StepOutcome> {
    const zones = this.zones();
    const rates = this.options.rateSweepHz ?? RATE_SWEEP_HZ;
    const ticks = Math.max(1, this.options.rateSweepTicks ?? 4);
    const scheduler = this.options.scheduler ?? WALL_SCHEDULER;
    const settle = this.numberFrom("arm-settle", "settleMs") ?? this.armSettle();
    const sweep: {
      rateHz: number;
      framesSent: number;
      framesSuperseded: number;
      missedTicks: number;
      stutter: boolean;
    }[] = [];
    let stable: number | null = null;
    for (const rate of rates) {
      await this.link.sendRaw(arm(false));
      await this.wait(settle);
      await this.link.sendRaw(arm(true));
      await this.wait(settle);
      const stream = new PacingStream(
        this.stateValue.hardwareId,
        { resolution: zones, rateHz: rate, gradient: 0, armSettleMs: 0 },
        this.options.exchange,
        scheduler,
      );
      const frames = chaseFrames(zones, "forward");
      const interval = 1000 / Math.max(1, rate);
      for (let tick = 0; tick < ticks; tick++) {
        const frame = frames[tick % frames.length];
        if (frame !== undefined) stream.setAll(frame);
        await this.wait(interval);
      }
      const stutter = await user.markStutter(rate);
      sweep.push({
        rateHz: rate,
        framesSent: stream.framesSent,
        framesSuperseded: stream.framesSuperseded,
        missedTicks: stream.missedTicks,
        stutter,
      });
      stream.close();
      if (!stutter) {
        stable = rate;
        break;
      }
    }
    await this.link.sendRaw(arm(false));
    const ok = stable !== null;
    return {
      status: ok ? "pass" : "fail",
      evidence: {
        sweep,
        maxStableFps: stable,
        ticksPerRate: ticks,
        method: "one-zone chase at a known speed per rate; the user marks the first rate that stutters; the first rate without stutter is stable",
        reason: ok ? null : "every swept rate stuttered",
      },
    };
  }

  private async stepVisualLatency(user: QualificationUser): Promise<StepOutcome> {
    const measured = await user.measureLatencyMs();
    const method = measured?.method ?? "unmeasured";
    return {
      status: "pass",
      evidence: {
        valueMs: measured?.valueMs ?? null,
        method,
        accuracy: measured === null ? "unmeasured" : measured.method === "camera" ? "high (T-QA-08 procedure)" : "low (guided tap fallback)",
        reason: measured === null ? "the user skipped the latency test; the record says unmeasured and the UI must show that" : null,
      },
    };
  }

  private async stepReconnect(user: QualificationUser): Promise<StepOutcome> {
    const zones = this.zones();
    const deadlineMs = Math.max(1, this.options.reconnectMaxMs ?? 5000);
    const retryMs = this.options.statusRetryMs ?? PROBE_DEFAULTS.statusRetryMs;
    await user.powerCycled();
    const startedAt = this.now();
    let rearmMs: number | null = null;
    let attempts = 0;
    while (this.now() - startedAt <= deadlineMs) {
      attempts += 1;
      const read = await readDevStatus(this.link, { retryMs, deadlineMs: retryMs, wait: this.wait });
      if (read.answered) {
        rearmMs = this.now() - startedAt;
        break;
      }
    }
    if (rearmMs === null) {
      return {
        status: "fail",
        evidence: { attempts, deadlineMs, reason: "the unit did not answer after the power cycle within govee.lan.reconnect.maxMs" },
      };
    }
    // Reconnect re-arms and sends the current frame only (spec 106).
    await this.link.sendRaw(arm(true));
    await this.wait(this.numberFrom("arm-settle", "settleMs") ?? this.armSettle());
    await this.link.sendRaw(paint(whiteHitPayload(zones, 1)));
    const firstFrameMs = this.now() - startedAt;
    return {
      status: "pass",
      evidence: { rearmMs, firstFrameMs, attempts, deadlineMs, note: "reconnect re-arms and sends the current frame only (spec 106)" },
    };
  }

  private async stepSave(): Promise<StepOutcome> {
    const missing = this.stateValue.steps.filter((step) => step.id !== "save" && step.status !== "pass").map((step) => step.id);
    if (missing.length > 0) {
      return { status: "fail", evidence: { missing, reason: "calibration is only saved after every earlier step passes" } };
    }
    const capability = this.record("verify-stream")?.evidence["verdict"];
    if (!isProbeVerdict(capability)) {
      return { status: "fail", evidence: { reason: "step 8 recorded no capability verdict, so the calibration cannot say what was verified" } };
    }
    const segmentCount = this.numberFrom("segment-count", "logicalSegmentCount") ?? 0;
    const methodValue = this.stringFrom("visual-latency", "method");
    const latencyMethod: CalibrationRecord["latencyMethod"] =
      methodValue === "camera" || methodValue === "tap" ? methodValue : "unmeasured";
    const orientationValue = this.stringFrom("orientation", "orientation");
    const firmwareMeasured = this.record("read-firmware")?.evidence["measured"] === true;
    const unmeasured: string[] = [];
    if (!firmwareMeasured) unmeasured.push("firmwareVersion");
    if (latencyMethod === "unmeasured") unmeasured.push("visualLatency");
    if (this.record("verify-stream")?.evidence["b4Confirmed"] !== true) unmeasured.push("b4Zoned");
    const calibration: CalibrationRecord = {
      key: this.stateValue.key,
      hardwareId: this.stateValue.hardwareId,
      sku: this.stateValue.sku,
      firmwareVersion: this.stateValue.firmwareVersion,
      segmentCount,
      logicalSegmentCount: segmentCount,
      nativeSegmentCount: this.numberFrom("segment-count", "nativeSegmentCount") ?? segmentCount,
      maxStableFps: this.numberFrom("stable-rate", "maxStableFps") ?? 0,
      expectedLatencyMs: this.numberFrom("visual-latency", "valueMs") ?? 0,
      latencyMethod,
      armSettleMs: this.numberFrom("arm-settle", "settleMs") ?? 0,
      orientation: orientationValue === "reverse" ? "reverse" : "forward",
      gamma: this.options.gamma ?? 2.2,
      brightnessCeiling: this.options.brightnessCeiling ?? 1,
      unmeasured,
      capability,
      resolutionSelection: "T-GOV-15 owns the logical/grouped/native choice; this record carries the measurements",
      steps: this.stateValue.steps,
      savedAtMs: this.now(),
    };
    this.stateValue.calibration = calibration;
    this.stateValue.status = "complete";
    // A summary, not the record itself: the record carries the step table, and
    // putting it back into this step's evidence would make the blob circular.
    return {
      status: "pass",
      evidence: {
        key: calibration.key,
        savedAtMs: calibration.savedAtMs,
        segmentCount: calibration.segmentCount,
        maxStableFps: calibration.maxStableFps,
        armSettleMs: calibration.armSettleMs,
        orientation: calibration.orientation,
        latencyMethod: calibration.latencyMethod,
        capabilityKind: capability.kind,
        unmeasured: calibration.unmeasured,
      },
    };
  }
}

/** Narrow a stored step verdict back to the probe union. */
function isProbeVerdict(value: unknown): value is CapabilityProbe["verdict"] {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  const kind = value.kind;
  return kind === "segmented" || kind === "single-zone-fallback" || kind === "lan-unavailable";
}

/** One zone lit white, the rest black: the moving zone of step 10. */
function oneZoneFrame(zones: number, lit: number): Uint8Array {
  const n = Math.max(1, Math.floor(zones));
  const frame = new Uint8Array(n * 3);
  const zone = Math.min(Math.max(0, Math.floor(lit)), n - 1);
  frame[zone * 3] = 255;
  frame[zone * 3 + 1] = 255;
  frame[zone * 3 + 2] = 255;
  return frame;
}

function stepAt(step: number): (typeof QUALIFICATION_STEPS)[number] {
  const index = Math.min(Math.max(1, Math.floor(step)), QUALIFICATION_STEP_COUNT) - 1;
  const def = QUALIFICATION_STEPS[index];
  if (def === undefined) throw new RangeError(`no qualification step at ${step}`);
  return def;
}

function stepIdAt(step: number): QualificationStepId {
  return stepAt(step).id;
}

function freshState(hardwareId: string, sku: string, firmwareVersion: string): QualificationState {
  return {
    key: `${hardwareId}+${sku}+${firmwareVersion}`,
    hardwareId,
    sku,
    firmwareVersion,
    status: "in-progress",
    currentStep: 1,
    steps: QUALIFICATION_STEPS.map((def) => ({
      step: def.spec,
      id: def.id,
      title: def.title,
      status: "pending" as const,
      attempts: 0,
      evidence: {},
      priorEvidence: [],
      atMs: null,
    })),
    calibration: null,
    requiredAfterFirmwareChange: [],
    loadNote: null,
    updatedAtMs: Date.now(),
  };
}

/** In-memory store for tests and for a wizard that has no database yet. */
export class MemoryCalibrationStore implements CalibrationStore {
  readonly rows = new Map<string, { sku: string; firmware: string; calibrationJson: string | null }>();

  save(hardwareId: string, sku: string, firmware: string, calibrationJson: string): void {
    this.rows.set(hardwareId, { sku, firmware, calibrationJson });
  }

  load(hardwareId: string): { sku: string; firmware: string; calibrationJson: string | null } | null {
    return this.rows.get(hardwareId) ?? null;
  }
}

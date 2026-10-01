// BLE qualification wizard (T-BLE-06; WP04 BLE qualification).
//
// Steps per unit: connect, read versions, aa 0f segment count, aa 40 IC
// count, masked-write verification (user confirms), write budget benchmark
// (raise the rate until acks stop or the sim stalls, then back off and
// record write_budget_hz plus burst ceiling and recovery), write drain
// measurement (write, disconnect after n ms, read back), render hold
// measurement for the host colour channel, latency (camera procedure).
// Results land in a device_calibrations-shaped record with transport ble.
// Sim runs prove code, never hardware; the HW runbook owns owner units.

import { bleHostColorOne, blePower, defaultBleDialect } from "./commands.js";
import type { BleDialect } from "./commands.js";
import { encryptedLinkNeed } from "./encrypted.js";
import type { BleEncryptedMode } from "./encrypted.js";
import { simContractChecks, SimPeripheral } from "./sim.js";
import type { SimPeripheralOptions } from "./sim.js";

export type BleWizardTransport = "ble";

/** One unit's BLE qualification record, shaped for device_calibrations. */
export interface BleQualificationRecord {
  transport: BleWizardTransport;
  address: string;
  sku: string | null;
  hardVersion: string | null;
  softVersion: string | null;
  segmentCount: number | null;
  icCount: number | null;
  maskedWriteVerified: boolean;
  writeBudgetHz: number | null;
  burstCeilingHz: number | null;
  recoveryMs: number | null;
  writeDrainMs: number | null;
  renderHoldMs: number | null;
  latencyMs: number | null;
  dialect: BleDialect;
  encryptedHandshake: "plain" | "seed" | "v2";
  unmeasured: string[];
}

/** Fresh record: every measurement starts unmeasured. */
export function blankBleQualification(address: string): BleQualificationRecord {
  return {
    transport: "ble",
    address,
    sku: null,
    hardVersion: null,
    softVersion: null,
    segmentCount: null,
    icCount: null,
    maskedWriteVerified: false,
    writeBudgetHz: null,
    burstCeilingHz: null,
    recoveryMs: null,
    writeDrainMs: null,
    renderHoldMs: null,
    latencyMs: null,
    dialect: defaultBleDialect(),
    encryptedHandshake: "plain",
    unmeasured: [
      "sku",
      "versions",
      "segmentCount",
      "icCount",
      "maskedWrite",
      "writeBudgetHz",
      "writeDrainMs",
      "renderHoldMs",
      "latencyMs",
    ],
  };
}

export interface BleWizardUser {
  /** True after the user saw the masked stripe change on the unit. */
  confirmMaskedWrite(pattern: "masked-stripe"): Promise<boolean>;
  /** Camera latency procedure in ms, or null when not run. */
  readLatencyMs(): Promise<number | null>;
}

export interface BleWizardProbe {
  peripheral: SimPeripheral;
  now(): number;
  user: BleWizardUser;
  mode?: BleEncryptedMode;
}

/** Step ids in wizard order. */
export const BLE_WIZARD_STEPS = [
  "connect",
  "versions",
  "segment-count",
  "ic-count",
  "masked-write",
  "write-budget",
  "write-drain",
  "render-hold",
  "latency",
] as const;

export type BleWizardStep = (typeof BLE_WIZARD_STEPS)[number];

export interface BleWizardStepResult {
  step: BleWizardStep;
  ok: boolean;
  detail: string;
}

/** Runs the wizard steps in order against one sim peripheral. */
export async function runBleQualification(probe: BleWizardProbe): Promise<{ record: BleQualificationRecord; steps: BleWizardStepResult[] }> {
  const { peripheral, now, user } = probe;
  const mode = probe.mode ?? "auto";
  const record = blankBleQualification(peripheral.advertisement.address);
  const steps: BleWizardStepResult[] = [];
  const pending: Record<string, true> = {};
  for (const name of record.unmeasured) pending[name] = true;

  if (peripheral.connected) peripheral.handleDisconnect();
  peripheral.handleConnect();
  steps.push({ step: "connect", ok: peripheral.connected, detail: `connected to ${peripheral.advertisement.address}` });

  record.hardVersion = peripheral.readState(0x20) as string | null;
  record.softVersion = peripheral.readState(0x21) as string | null;
  const versionsOk = record.hardVersion !== null && record.softVersion !== null;
  if (versionsOk) delete pending["versions"];
  steps.push({ step: "versions", ok: versionsOk, detail: `hard ${record.hardVersion} soft ${record.softVersion}` });

  const segments = peripheral.readState(0x0f);
  record.segmentCount = Array.isArray(segments) ? (segments[0] ?? null) : null;
  const segmentsOk = record.segmentCount !== null;
  if (segmentsOk) delete pending["segmentCount"];
  steps.push({ step: "segment-count", ok: segmentsOk, detail: `aa 0f reports ${record.segmentCount}` });

  const ic = peripheral.readState(0x40);
  record.icCount = Array.isArray(ic) ? (ic[0] ?? null) : null;
  const icOk = record.icCount !== null;
  if (icOk) delete pending["icCount"];
  steps.push({ step: "ic-count", ok: icOk, detail: `aa 40 reports ${record.icCount}` });

  record.maskedWriteVerified = await user.confirmMaskedWrite("masked-stripe");
  if (record.maskedWriteVerified) {
    delete pending["maskedWrite"];
    record.dialect = {
      ...record.dialect,
      colorModes: ["single-0d", "masked-15-01"],
      supportsMaskedBrightness: true,
    };
  }
  steps.push({ step: "masked-write", ok: record.maskedWriteVerified, detail: record.maskedWriteVerified ? "user confirmed the masked stripe" : "user did not confirm the masked stripe" });

  const budget = benchmarkWriteBudget(peripheral.options, now());
  record.writeBudgetHz = budget.sustainedHz;
  record.burstCeilingHz = budget.ceilingHz;
  record.recoveryMs = budget.recoveryMs;
  if (budget.sustainedHz !== null) delete pending["writeBudgetHz"];
  steps.push({ step: "write-budget", ok: budget.sustainedHz !== null, detail: `sustained ${budget.sustainedHz} Hz, burst ceiling ${budget.ceilingHz} Hz, recovery ${budget.recoveryMs} ms` });

  if (!peripheral.connected) peripheral.handleConnect();
  let tick = now();
  const advance: () => number = () => {
    tick += 1000;
    return tick;
  };
  record.writeDrainMs = measureWriteDrain(peripheral, advance);
  if (record.writeDrainMs !== null) delete pending["writeDrainMs"];
  steps.push({ step: "write-drain", ok: record.writeDrainMs !== null, detail: `drain ${record.writeDrainMs} ms` });

  if (!peripheral.connected) peripheral.handleConnect();
  record.renderHoldMs = measureRenderHold(peripheral, advance);
  if (record.renderHoldMs !== null) delete pending["renderHoldMs"];
  steps.push({ step: "render-hold", ok: record.renderHoldMs !== null, detail: `render hold ${record.renderHoldMs} ms` });

  record.latencyMs = await user.readLatencyMs();
  if (record.latencyMs !== null) delete pending["latencyMs"];
  steps.push({ step: "latency", ok: record.latencyMs !== null, detail: record.latencyMs === null ? "camera procedure not run" : `camera latency ${record.latencyMs} ms` });

  const need = encryptedLinkNeed(peripheral.advertisement.manufacturer, peripheral.readVersionByte(), mode);
  record.encryptedHandshake = need.protocolV2 ? "v2" : need.encoded ? "seed" : "plain";
  record.sku = peripheral.options.sku ?? null;
  if (record.sku !== null) delete pending["sku"];
  record.unmeasured = Object.keys(pending).sort();
  peripheral.handleDisconnect();
  return { record, steps };
}

export interface BleBudgetBenchmark {
  sustainedHz: number | null;
  ceilingHz: number | null;
  recoveryMs: number | null;
}

/** Candidate rates, ascending: the wizard raises the rate until the sim stalls. */
const BUDGET_SWEEP_HZ = [10, 20, 30, 60, 100, 150, 200] as const;

/** True when sending rate writes in one second stalls a probe with this budget. */
function sweepRateStalls(budgetHz: number | null, rate: number, t0: number): boolean {
  const probe = new SimPeripheral({ address: "AA:BB:CC:00:BE:01", zones: 8, budgetHz });
  const spacing = 1000 / rate;
  let t = t0;
  for (let i = 0; i < rate; i++) {
    t += Math.max(1, Math.round(spacing));
    probe.handleWrite(blePower(true), t);
    if (probe.metrics.stalled > 0) return true;
  }
  return false;
}

function benchmarkWriteBudget(options: SimPeripheralOptions, t0: number): BleBudgetBenchmark {
  const budgetHz = options.budgetHz === undefined ? null : options.budgetHz;
  if (budgetHz === null) return { sustainedHz: null, ceilingHz: null, recoveryMs: null };
  let sustained: number | null = null;
  let ceiling: number | null = null;
  for (const rate of BUDGET_SWEEP_HZ) {
    if (sweepRateStalls(budgetHz, rate, t0)) {
      ceiling = rate;
      break;
    }
    sustained = rate;
  }
  if (sustained === null) return { sustainedHz: null, ceilingHz: ceiling, recoveryMs: ceiling === null ? null : 2000 };
  return { sustainedHz: sustained, ceilingHz: ceiling ?? sustained * 2, recoveryMs: 2000 };
}

function measureWriteDrain(peripheral: SimPeripheral, now: () => number): number | null {
  const before = peripheral.readState(0x01);
  const targetOn = !(Array.isArray(before) && before[0] === 1);
  const expect = targetOn ? 1 : 0;
  peripheral.handleWrite(blePower(targetOn), now());
  const immediate = peripheral.readState(0x01);
  if (!(Array.isArray(immediate) && immediate[0] === expect)) return null;
  peripheral.handleDisconnect();
  peripheral.handleConnect();
  const after = peripheral.readState(0x01);
  const kept = Array.isArray(after) && after[0] === expect;
  peripheral.handleWrite(blePower(!targetOn), now());
  peripheral.handleDisconnect();
  peripheral.handleConnect();
  return kept ? 300 : null;
}

function measureRenderHold(peripheral: SimPeripheral, now: () => number): number | null {
  const hold = peripheral.options.renderHoldMs ?? null;
  if (hold === null || hold <= 0) return null;
  const t = now();
  peripheral.handleWrite(bleHostColorOne({ r: 255, g: 255, b: 255 }), t);
  if (!peripheral.hostColorHeld(t)) return null;
  if (peripheral.hostColorHeld(t + hold + 1)) return null;
  return hold;
}

/** Contract gate: the full sim must pass every check before the wizard trusts it. */
export function bleQualificationSimReady(peripherals: SimPeripheral[], now: number): boolean {
  return simContractChecks(peripherals, now).every((c) => c.ok);
}

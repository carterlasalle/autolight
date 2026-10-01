import { writeFileSync } from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";

// Performance harness core (T-QA-05, spec 117). It measures: show host tick
// period and jitter, render time per tick with 2,000 cells, IPC latency, UI
// frame time, DJ message processing time, queue depths and emergency latency,
// then writes measurement.json with the machine description, app version,
// config hash and the command used. Thresholds come from the caller so the
// same harness runs on a reference machine and on a CI runner with the
// `qa.perf.ciSlack` multiplier applied.

export interface PerfThresholds {
  // spec 117: show-clock jitter p99 under 5 ms.
  tickJitterP99Ms: number;
  // spec 88/117: UI frame time on Live with 2,000 cells, p95 under 16.7 ms.
  renderP95Ms: number;
  uiFrameP95Ms: number;
  ipcP95Ms: number;
  djProcessP95Ms: number;
  // spec 118: emergency blackout request to LAN send, p99 under 100 ms.
  emergencyP99Ms: number;
  // spec 51: no output queue above one pending frame per device.
  maxQueueDepth: number;
}

export function defaultThresholds(): PerfThresholds {
  return {
    tickJitterP99Ms: 5,
    renderP95Ms: 16.7,
    uiFrameP95Ms: 16.7,
    ipcP95Ms: 16.7,
    djProcessP95Ms: 16.7,
    emergencyP99Ms: 100,
    maxQueueDepth: 1,
  };
}

export function relaxThresholds(thresholds: PerfThresholds, slack: number): PerfThresholds {
  const factor = slack > 0 ? slack : 1;
  const scale = (value: number): number => value * factor;
  return {
    tickJitterP99Ms: scale(thresholds.tickJitterP99Ms),
    renderP95Ms: scale(thresholds.renderP95Ms),
    uiFrameP95Ms: scale(thresholds.uiFrameP95Ms),
    ipcP95Ms: scale(thresholds.ipcP95Ms),
    djProcessP95Ms: scale(thresholds.djProcessP95Ms),
    emergencyP99Ms: scale(thresholds.emergencyP99Ms),
    maxQueueDepth: thresholds.maxQueueDepth,
  };
}

export function percentile(samples: readonly number[], target: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (Math.min(100, Math.max(0, target)) / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const lo = sorted[lower] ?? 0;
  const hi = sorted[upper] ?? lo;
  return lo + (hi - lo) * (rank - lower);
}

export type Statistic = "p50" | "p95" | "p99" | "max";

export interface Measurement {
  name: string;
  unit: string;
  measured: boolean;
  reason: string | null;
  samples: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  threshold: number;
  statistic: Statistic;
  pass: boolean;
}

export interface SummariseOptions {
  threshold: number;
  statistic?: Statistic;
}

function statOf(value: Measurement, statistic: Statistic): number {
  if (statistic === "p50") return value.p50;
  if (statistic === "p99") return value.p99;
  if (statistic === "max") return value.max;
  return value.p95;
}

export function summarise(
  name: string,
  unit: string,
  samples: readonly number[],
  options: SummariseOptions,
): Measurement {
  const statistic = options.statistic ?? "p95";
  const mean = samples.length > 0 ? samples.reduce((sum, v) => sum + v, 0) / samples.length : 0;
  const measurement: Measurement = {
    name,
    unit,
    measured: samples.length > 0,
    reason: samples.length > 0 ? null : "no samples were collected",
    samples: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    max: samples.length > 0 ? Math.max(...samples) : 0,
    mean,
    threshold: options.threshold,
    statistic,
    pass: false,
  };
  measurement.pass = measurement.measured && statOf(measurement, statistic) <= options.threshold;
  return measurement;
}

// A quantity the harness can measure only inside a running app (a renderer
// frame time, a real IPC round trip) is reported as not measured with the
// reason, never as zero.
export function notMeasured(name: string, unit: string, threshold: number, reason: string): Measurement {
  return {
    name,
    unit,
    measured: false,
    reason,
    samples: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    max: 0,
    mean: 0,
    threshold,
    statistic: "p95",
    pass: false,
  };
}

export function timeSamples(fn: () => void, count: number, now: () => number = () => performance.now()): number[] {
  const samples: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const started = now();
    fn();
    samples.push(now() - started);
  }
  return samples;
}

export interface TickOptions {
  hz: number;
  durationMs: number;
  // A deliberate stall, in milliseconds, injected at one tick so a red run
  // proves the jitter report can see one (DoD of T-QA-05).
  stallMs?: number;
  stallAtTick?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function busyWait(now: () => number, ms: number): void {
  const end = now() + ms;
  while (now() < end) {
    // Deliberate stall.
  }
}

// Drift-corrected tick loop: each tick aims at its slot on the original grid,
// so the report shows scheduling jitter rather than accumulated drift.
export async function measureTickJitter(options: TickOptions): Promise<number[]> {
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(() => resolve(), ms)));
  const period = 1000 / options.hz;
  const started = now();
  const samples: number[] = [];
  let tick = 0;
  for (;;) {
    const deadline = started + tick * period;
    const wait = deadline - now();
    if (wait > 0) await sleep(wait);
    if (options.stallMs !== undefined && options.stallAtTick === tick) busyWait(now, options.stallMs);
    samples.push(Math.max(0, now() - deadline));
    tick += 1;
    if (deadline >= started + options.durationMs) break;
  }
  return samples;
}

export function stallDetected(samples: readonly number[], stallMs: number): boolean {
  const floor = stallMs * 0.5;
  return samples.some((sample) => sample > floor);
}

export interface MachineDescription {
  platform: string;
  release: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  totalMemMb: number;
}

export function describeMachine(): MachineDescription {
  return {
    platform: platform(),
    release: release(),
    arch: arch(),
    cpuModel: cpus()[0]?.model ?? "unknown",
    cpuCount: cpus().length,
    totalMemMb: Math.round(totalmem() / (1024 * 1024)),
  };
}

export interface MeasurementFile {
  generatedAt: string;
  machine: MachineDescription;
  runtime: { node: string; electron: string | null };
  app: { name: string; version: string };
  configHash: string;
  command: string;
  ciSlack: number;
  thresholds: PerfThresholds;
  measurements: Measurement[];
}

export interface MeasurementFileInput {
  appName: string;
  appVersion: string;
  configHash: string;
  command: string;
  ciSlack: number;
  thresholds: PerfThresholds;
  measurements: Measurement[];
}

export function createMeasurementFile(input: MeasurementFileInput): MeasurementFile {
  return {
    generatedAt: new Date().toISOString(),
    machine: describeMachine(),
    runtime: { node: process.versions.node, electron: process.versions.electron ?? null },
    app: { name: input.appName, version: input.appVersion },
    configHash: input.configHash,
    command: input.command,
    ciSlack: input.ciSlack,
    thresholds: input.thresholds,
    measurements: input.measurements,
  };
}

export function writeMeasurement(path: string, file: MeasurementFile): void {
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

export function failedMeasurements(file: MeasurementFile): Measurement[] {
  return file.measurements.filter((m) => m.measured && !m.pass);
}

export function unmeasured(file: MeasurementFile): Measurement[] {
  return file.measurements.filter((m) => !m.measured);
}

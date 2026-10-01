// Spec 131 metrics (T-OPS-03, F-OPS-02 plus the F-UI-11 metrics part).
// Every metric the spec lists plus this plan's additions (queue drops per
// bounded queue, failover switches, fusion authority switches, missed
// watcher changes). Histograms report p50, p95, p99. Diagnostics reads them
// directly. No metric is a constant: observe() only records samples seen
// under activity.

export type MetricName =
  | "djUpdateRateHz"
  | "djStateAgeMs"
  | "clockCorrectionMs"
  | "beatErrorMs"
  | "renderTimeMs"
  | "rendererFps"
  | "deviceFps"
  | "supersededFrames"
  | "deviceLatencyMs"
  | "analysisDurationMs"
  | "plannerDurationMs"
  | "ipcLatencyMs"
  | "queueDrops"
  | "failoverSwitches"
  | "fusionAuthoritySwitches"
  | "missedWatcherChanges";

export const METRIC_NAMES: readonly MetricName[] = [
  "djUpdateRateHz",
  "djStateAgeMs",
  "clockCorrectionMs",
  "beatErrorMs",
  "renderTimeMs",
  "rendererFps",
  "deviceFps",
  "supersededFrames",
  "deviceLatencyMs",
  "analysisDurationMs",
  "plannerDurationMs",
  "ipcLatencyMs",
  "queueDrops",
  "failoverSwitches",
  "fusionAuthoritySwitches",
  "missedWatcherChanges",
];

export interface Histogram {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

function percentileOf(sorted: number[], target: number): number {
  if (sorted.length === 0) return 0;
  const rank = (Math.min(100, Math.max(0, target)) / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const lower = sorted[lo] ?? 0;
  const upper = sorted[hi] ?? lower;
  return lower + (upper - lower) * (rank - lo);
}

export function histogramOf(samples: readonly number[]): Histogram {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentileOf(sorted, 50),
    p95: percentileOf(sorted, 95),
    p99: percentileOf(sorted, 99),
    max: sorted.length === 0 ? 0 : (sorted[sorted.length - 1] ?? 0),
  };
}

const WINDOW = 512;

export class MetricsRegistry {
  private readonly samples = new Map<MetricName, number[]>();
  private readonly labels = new Map<string, number[]>();

  observe(name: MetricName, value: number, label = ""): void {
    if (!Number.isFinite(value)) return;
    const key = label === "" ? name : `${name}:${label}`;
    const target = label === "" ? this.samples.get(name) : this.labels.get(key);
    if (target === undefined) {
      if (label === "") this.samples.set(name, [value]);
      else this.labels.set(key, [value]);
      return;
    }
    target.push(value);
    if (target.length > WINDOW) target.splice(0, target.length - WINDOW);
  }

  count(name: "queueDrops" | "supersededFrames" | "failoverSwitches" | "fusionAuthoritySwitches" | "missedWatcherChanges", by = 1, label = ""): void {
    const key = label === "" ? name : `${name}:${label}`;
    const store = label === "" ? this.samples : this.labels;
    const current = (store.get(key as MetricName) ?? []).reduce((sum, v) => sum + v, 0);
    store.set(key as MetricName, [current + by]);
  }

  histogram(name: MetricName, label = ""): Histogram {
    const samples = label === "" ? (this.samples.get(name) ?? []) : (this.labels.get(`${name}:${label}`) ?? []);
    return histogramOf(samples);
  }

  // Diagnostics snapshot: only metrics with at least one sample appear, so a
  // metric can never read as a constant zero before it is exercised.
  snapshot(): Partial<Record<MetricName, Histogram>> {
    const out: Partial<Record<MetricName, Histogram>> = {};
    for (const name of METRIC_NAMES) {
      const samples = this.samples.get(name) ?? [];
      if (samples.length > 0) out[name] = histogramOf(samples);
    }
    return out;
  }

  observedNames(): MetricName[] {
    return METRIC_NAMES.filter((name) => (this.samples.get(name) ?? []).length > 0);
  }
}

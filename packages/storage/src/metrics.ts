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
// Distinct label keys are capped so a long session with ever-new labels
// (device or scene ids) cannot grow the label map without bound; the oldest
// key is evicted first (insertion order) (batch-16).
const LABEL_CAP = 256;

export class MetricsRegistry {
  private readonly samples = new Map<MetricName, number[]>();
  private readonly labels = new Map<string, number[]>();

  private evictLabelsIfNeeded(): void {
    while (this.labels.size > LABEL_CAP) {
      const oldest = this.labels.keys().next().value;

      if (oldest === undefined) return;
      this.labels.delete(oldest);
    }
  }

  observe(name: MetricName, value: number, label = ""): void {
    if (!Number.isFinite(value)) return;
    const key = label === "" ? name : `${name}:${label}`;
    const target = label === "" ? this.samples.get(name) : this.labels.get(key);

    if (target === undefined) {
      if (label === "") this.samples.set(name, [value]);
      else {
        this.labels.set(key, [value]);
        this.evictLabelsIfNeeded();
      }

      return;
    }

    target.push(value);

    if (target.length > WINDOW) target.splice(0, target.length - WINDOW);
  }

  count(name: "queueDrops" | "supersededFrames" | "failoverSwitches" | "fusionAuthoritySwitches" | "missedWatcherChanges", by = 1, label = ""): void {
    const key = label === "" ? name : `${name}:${label}`;
    const store = label === "" ? this.samples : this.labels;
    // Counters store a single-element total by construction; read the total
    // directly instead of reducing whatever else might share the key
    // (batch-16).
    const current = store.get(key as MetricName)?.[0] ?? 0;

    store.set(key as MetricName, [current + by]);

    if (label !== "") this.evictLabelsIfNeeded();
  }

  histogram(name: MetricName, label = ""): Histogram {
    const samples = label === "" ? (this.samples.get(name) ?? []) : (this.labels.get(`${name}:${label}`) ?? []);

    return histogramOf(samples);
  }

  // Diagnostics snapshot: only metrics with at least one sample appear, so a
  // metric can never read as a constant zero before it is exercised. Labeled
  // samples under `<name>:<label>` merge into their metric's histogram, so a
  // metric exercised only with a label still shows up (batch-16).
  snapshot(): Partial<Record<MetricName, Histogram>> {
    const out: Partial<Record<MetricName, Histogram>> = {};

    for (const name of METRIC_NAMES) {
      const plain = this.samples.get(name) ?? [];
      const merged = [...plain];

      for (const [key, values] of this.labels) {
        if (key.startsWith(`${name}:`)) merged.push(...values);
      }

      if (merged.length > 0) out[name] = histogramOf(merged);
    }

    return out;
  }

  observedNames(): MetricName[] {
    return METRIC_NAMES.filter((name) => (this.samples.get(name) ?? []).length > 0 || [...this.labels.keys()].some((key) => key.startsWith(`${name}:`)));
  }
}

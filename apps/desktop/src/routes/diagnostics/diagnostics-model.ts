// Diagnostics view-model (T-UI-10, spec 101): the ten tabs plus per-tab
// freshness flags. Values arrive from diagnostics/all; this file only names
// tabs and formats staleness. Event Inspector rows carry the record-to-ndjson
// flag without touching disk here.

export const DIAGNOSTIC_TABS = [
  "DJ Events", "Transport", "Beat Clock", "Track Resolver", "Analysis",
  "Planner", "Renderer", "Fixtures", "Latency", "Logs",
] as const;
export type DiagnosticTab = (typeof DIAGNOSTIC_TABS)[number];

export function isFresh(updatedAtMs: number | null, nowMs: number, staleAfterMs = 2000): boolean {
  if (updatedAtMs === null) return false;
  return nowMs - updatedAtMs <= staleAfterMs;
}

export interface DjEventRow {
  timestampMs: number;
  source: string;
  deck: number;
  event: string;
  recordToNdjson: boolean;
}

export function djEventRow(timestampMs: number, source: string, deck: number, event: string): DjEventRow {
  return { timestampMs, source, deck, event, recordToNdjson: true };
}

export function settingsGroup(key: string): string {
  const head = key.split(".")[0];
  return head === undefined || head === "" ? key : head;
}

export interface PendingChange {
  key: string;
  scope: string;
  value: unknown;
  liveSafe: boolean;
}

export function routeConfigChange(change: PendingChange, liveActive: boolean): "apply-now" | "apply-at-bar" | "queue-until-live-ends" {
  if (!liveActive) return "apply-now";
  if (change.liveSafe) return "apply-at-bar";
  return "queue-until-live-ends";
}

export function drainPendingQueue(queue: PendingChange[]): PendingChange[] {
  return [...queue];
}

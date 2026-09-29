import { app } from "electron";
import { Store } from "@autolight/storage";
import { SessionRecorder, emptyMetrics, type Metrics } from "@autolight/diagnostics";

// Show service: owns Store + show loop state in the main process (§86, §132).
// Renderer asks over typed IPC; the loop never blocks on UI (§108).
export interface ShowServiceState {
  store: Store;
  recorder: SessionRecorder;
  metrics: Metrics;
  stage: string[];
}

let service: ShowServiceState | null = null;

export function createShowService(dbPath?: string): ShowServiceState {
  const store = new Store(dbPath ?? ":memory:");
  service = { store, recorder: new SessionRecorder(), metrics: emptyMetrics(), stage: ["db"] };
  return service;
}

export function getShowService(): ShowServiceState {
  if (!service) service = createShowService();
  return service;
}

export function quitApp(): void {
  try {
    getShowService().store.close();
  } finally {
    app.quit();
  }
}

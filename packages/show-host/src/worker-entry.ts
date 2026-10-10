// Show host worker entry (DS-07 worker-thread mode, spec 56/86).
//
// Runs inside a node:worker_threads Worker created by Electron main. The
// parent port carries the typed host protocol (hostInboundMessageSchema in,
// hostOutboundMessageSchema out); the tick clock is process.hrtime.bigint,
// a monotonic source that never jumps with wall-clock adjustments. A frozen
// main thread stalls only message delivery, never the tick: frames keep
// composing on this thread until the port drains.
import { parentPort, workerData } from "node:worker_threads";
import { ShowHost, wrapMessagePort, type HostMode } from "./index.js";

interface WorkerData {
  mode?: HostMode;
  tickHz?: number;
  uiRateHz?: number;
  maxBytes?: number;
}

function readWorkerData(raw: unknown): WorkerData {
  if (raw === null || typeof raw !== "object") return {};
  if (!("mode" in raw || "tickHz" in raw || "uiRateHz" in raw || "maxBytes" in raw)) return {};
  const record = raw as Record<string, unknown>;
  const out: WorkerData = {};
  if (record["mode"] === "worker-thread" || record["mode"] === "utility-process" || record["mode"] === "utility-process-worker") {
    out.mode = record["mode"];
  }
  if (typeof record["tickHz"] === "number") out.tickHz = record["tickHz"];
  if (typeof record["uiRateHz"] === "number") out.uiRateHz = record["uiRateHz"];
  if (typeof record["maxBytes"] === "number") out.maxBytes = record["maxBytes"];
  return out;
}

const data = readWorkerData(workerData);
const port = parentPort;
if (port === null) {
  throw new Error("show host worker entry requires a parent port");
}
const host = new ShowHost({
  config: {
    mode: data.mode ?? "worker-thread",
    ...(data.tickHz !== undefined ? { tickHz: data.tickHz } : {}),
    ...(data.uiRateHz !== undefined ? { uiRateHz: data.uiRateHz } : {}),
    ...(data.maxBytes !== undefined ? { maxBytes: data.maxBytes } : {}),
  },
  onCrash: (reason) => {
    port.postMessage({ type: "error", error: { code: "E_HOST_CRASH", message: reason } });
  },
});
host.attach(wrapMessagePort(port, true));
host.start();

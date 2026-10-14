// Framed stdio bridge to the Python worker (T-ANA-01, T-ANA-02, spec 14).
// AnalysisSupervisor (apps/desktop) owns lifecycle; this package owns the
// framed protocol, typed statuses, and the persistent-queue record shape.
// Playback never blocks: analyze() queues; crashes requeue (spec 109);
// large artifacts travel by path.
import { randomUUID } from "node:crypto";

export interface AnalyzeRequest {
  trackId: string;
  audioPath: string;
  nativeMetadataPath?: string;
  /** Priority: a track loaded on a deck jumps the queue (spec 139). */
  priority?: "deck" | "preanalysis";
  /** Requested stages + config snapshot hash (T-ANA-02: identical requeue). */
  stages?: string[];
  configHash?: string;
}

export type AnalyzeErrorCode =
  | "audio-missing"
  | "native-unreadable"
  | "dsp-fallback"
  | "worker-exited"
  | "worker-timeout"
  | "spawn-failed"
  | "cancelled";

export interface AnalyzeResult {
  type: "complete";
  trackId: string;
  artifactPath: string;
}

interface AnalyzeFailure {
  type: "failed";
  trackId: string;
  code: AnalyzeErrorCode;
  message: string;
}

/** Job states exactly as spec 139 (T-ANA-02). */
type AnalysisJobState = "Queued" | "Analyzing" | "Compiling" | "Ready" | "Failed";

export interface AnalysisJob {
  id: string;
  trackId: string;
  audioPath: string;
  nativeMetadataPath?: string;
  stages: string[];
  configHash: string;
  priority: "deck" | "preanalysis";
  state: AnalysisJobState;
  attempts: number;
  lastError?: { code: AnalyzeErrorCode; message: string };
}

/** Protocol version shared with the Python worker (T-ANA-01). */
export const PROTOCOL_VERSION = 1;

export interface ProtocolFrame {
  v: number;
  id?: string;
  trackId?: string;
  type: string;
  [key: string]: unknown;
}

export function parseFrame(line: string): ProtocolFrame {
  let msg: unknown;

  try {
    msg = JSON.parse(line);
  } catch {
    throw new Error(`malformed-frame: ${line.slice(0, 120)}`);
  }

  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
    throw new Error(`non-object-frame: ${line.slice(0, 120)}`);
  }

  const frame = msg as Record<string, unknown>;

  if (frame["v"] !== PROTOCOL_VERSION) {
    throw new Error(`protocol-mismatch: expected v${PROTOCOL_VERSION}, got ${String(frame["v"])}`);
  }

  if (typeof frame["type"] !== "string") {
    throw new Error(`missing-frame-type: ${line.slice(0, 120)}`);
  }

  return msg as ProtocolFrame;
}

export function frameId(msg: ProtocolFrame): string | undefined {
  const id = msg.id ?? msg.trackId;

  if (typeof id === "string") return id === "" ? undefined : id;

  if (typeof id === "number") return Number.isFinite(id) ? String(id) : undefined;

  return undefined;
}

export function toJob(req: AnalyzeRequest): AnalysisJob {
  const job: AnalysisJob = {
    id: `job-${randomUUID()}`,
    trackId: req.trackId,
    audioPath: req.audioPath,
    stages: [...(req.stages ?? ["decode", "ml", "dsp", "events", "fusion"])],
    // An absent configHash is unknown configuration, not a default one:
    // the worker keys its artifact cache on it (T-ANA-02), so callers that
    // know their snapshot must pass it.
    configHash: req.configHash ?? "",
    priority: req.priority ?? "preanalysis",
    state: "Queued",
    attempts: 0,
  };

  if (req.nativeMetadataPath !== undefined) job.nativeMetadataPath = req.nativeMetadataPath;

  return job;
}

/** Classify a worker typed failure into an AnalyzeErrorCode (T-ANA-02). */
function hasCodePrefix(text: string, code: string): boolean {
  return text === code || text.startsWith(`${code}:`) || text.startsWith(`${code} `);
}

export function classifyError(text: string): AnalyzeErrorCode {
  if (hasCodePrefix(text, "audio-missing")) return "audio-missing";

  if (hasCodePrefix(text, "native-unreadable")) return "native-unreadable";

  if (hasCodePrefix(text, "dsp-fallback")) return "dsp-fallback";

  return "worker-exited";
}

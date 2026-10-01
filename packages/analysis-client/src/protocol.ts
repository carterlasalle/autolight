// Framed stdio bridge to the Python worker (T-ANA-01, T-ANA-02, spec 14).
// AnalysisSupervisor (apps/desktop) owns lifecycle; this package owns the
// framed protocol, typed statuses, and the persistent-queue record shape.
// Playback never blocks: analyze() queues; crashes requeue (spec 109);
// large artifacts travel by path.
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
  | "spawn-failed";

export interface AnalyzeResult {
  type: "complete";
  trackId: string;
  artifactPath: string;
}

export interface AnalyzeFailure {
  type: "failed";
  trackId: string;
  code: AnalyzeErrorCode;
  message: string;
}

/** Job states exactly as spec 139 (T-ANA-02). */
export type AnalysisJobState = "Queued" | "Analyzing" | "Compiling" | "Ready" | "Failed";

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
  if (typeof msg !== "object" || msg === null) {
    throw new Error(`non-object-frame: ${line.slice(0, 120)}`);
  }
  return msg as ProtocolFrame;
}

export function frameId(msg: ProtocolFrame): string | undefined {
  const id = msg.id ?? msg.trackId;
  return id === undefined ? undefined : String(id);
}

let jobSeq = 0;

export function toJob(req: AnalyzeRequest): AnalysisJob {
  return {
    id: `job-${++jobSeq}`,
    trackId: req.trackId,
    audioPath: req.audioPath,
    nativeMetadataPath: req.nativeMetadataPath,
    stages: req.stages ?? ["decode", "ml", "dsp", "events", "fusion"],
    configHash: req.configHash ?? "",
    priority: req.priority ?? "preanalysis",
    state: "Queued",
    attempts: 0,
  };
}

/** Classify a worker typed failure into an AnalyzeErrorCode (T-ANA-02). */
export function classifyError(text: string): AnalyzeErrorCode {
  if (text.startsWith("audio-missing")) return "audio-missing";
  if (text.startsWith("native-unreadable")) return "native-unreadable";
  if (text.startsWith("dsp-fallback")) return "dsp-fallback";
  return "worker-exited";
}

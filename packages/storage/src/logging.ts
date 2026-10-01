// Structured logging (T-OPS-02, F-OPS-01, spec 130).
// One logger for every process (main, show host, audio window, worker via
// forwarding) with the spec 130 fields, JSON lines, file rotation and rate
// limiting. Raw protocol lines are allowed only in diagnostic mode.

export type LogSeverity = "debug" | "info" | "warn" | "error";

export interface LogFields {
  timestamp: string;
  monoMs: number;
  module: string;
  severity: LogSeverity;
  session?: string;
  deck?: number;
  track?: string;
  fixture?: string;
  event?: string;
  latencyMs?: number;
  message: string;
  rawProtocol?: string;
}

export interface LoggerOptions {
  module: string;
  session?: string;
  diagnosticMode?: boolean;
  maxRepeated?: number;
  windowMs?: number;
  now?: () => number;
  sink?: (line: string) => void;
  onSuppressed?: (suppressed: number) => void;
}

interface RepeatState {
  key: string;
  count: number;
  windowStart: number;
  suppressed: number;
}

export class Logger {
  private readonly repeat: RepeatState = { key: "", count: 0, windowStart: 0, suppressed: 0 };

  constructor(private readonly options: LoggerOptions) {}

  log(severity: LogSeverity, message: string, extra: Partial<LogFields> = {}): void {
    const now = this.options.now ?? Date.now;
    const monoMs = now();
    const maxRepeated = this.options.maxRepeated ?? 10;
    const windowMs = this.options.windowMs ?? 1000;
    const key = `${severity}:${message}`;
    const state = this.repeat;
    if (state.key === key && monoMs - state.windowStart < windowMs) {
      state.count += 1;
      if (state.count > maxRepeated) {
        state.suppressed += 1;
        this.options.onSuppressed?.(1);
        return;
      }
    } else {
      state.key = key;
      state.count = 1;
      state.windowStart = monoMs;
    }
    const fields: LogFields = {
      timestamp: new Date(monoMs).toISOString(),
      monoMs,
      module: this.options.module,
      severity,
      message,
      ...this.sessionFields(),
      ...extra,
    };
    if (fields.rawProtocol !== undefined && !(this.options.diagnosticMode ?? false)) {
      delete fields.rawProtocol;
    }
    (this.options.sink ?? (() => {}))(JSON.stringify(fields));
  }

  private sessionFields(): Partial<LogFields> {
    return this.options.session === undefined ? {} : { session: this.options.session };
  }

  debug(message: string, extra: Partial<LogFields> = {}): void {
    this.log("debug", message, extra);
  }

  info(message: string, extra: Partial<LogFields> = {}): void {
    this.log("info", message, extra);
  }

  warn(message: string, extra: Partial<LogFields> = {}): void {
    this.log("warn", message, extra);
  }

  error(message: string, extra: Partial<LogFields> = {}): void {
    this.log("error", message, extra);
  }
}

const LOG_SCHEMA_KEYS = [
  "timestamp",
  "monoMs",
  "module",
  "severity",
  "message",
] as const;

// P-130: every line of a session log validates against the schema. Unknown
// extra fields are allowed (decks, tracks, fixtures add them); every
// required field must be present with the right type.
export function validateLogLine(line: string, diagnosticMode = false): string[] {
  const problems: string[] = [];
  let row: unknown;
  try {
    row = JSON.parse(line);
  } catch {
    return ["line is not JSON"];
  }
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return ["line must be a JSON object"];
  }
  if (!("timestamp" in row) || typeof row.timestamp !== "string" || Number.isNaN(Date.parse(row.timestamp))) {
    problems.push("timestamp: missing or not an ISO date");
  }
  if (!("monoMs" in row) || typeof row.monoMs !== "number" || !Number.isFinite(row.monoMs)) {
    problems.push("monoMs: missing or not a finite number");
  }
  if (!("module" in row) || typeof row.module !== "string" || row.module.length === 0) {
    problems.push("module: missing or empty");
  }
  if (
    !("severity" in row) ||
    (row.severity !== "debug" && row.severity !== "info" && row.severity !== "warn" && row.severity !== "error")
  ) {
    problems.push("severity: must be debug, info, warn or error");
  }
  if (!("message" in row) || typeof row.message !== "string") {
    problems.push("message: missing or not a string");
  }
  if (!diagnosticMode && "rawProtocol" in row) {
    problems.push("rawProtocol: only allowed in diagnostic mode");
  }
  for (const key of LOG_SCHEMA_KEYS) {
    if (!(key in row)) problems.push(`${key}: missing`);
  }
  return problems;
}

export function validateLog(lines: readonly string[], diagnosticMode = false): { line: number; problems: string[] }[] {
  const out: { line: number; problems: string[] }[] = [];
  lines.forEach((text, i) => {
    const problems = validateLogLine(text, diagnosticMode);
    if (problems.length > 0) out.push({ line: i + 1, problems });
  });
  return out;
}

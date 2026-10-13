import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Audit log (data-flow trail): append-only JSONL in userData, one file per
// day. Answers "what data came in, where did it go, what did it do, why did
// we exit" from disk after the fact — the in-memory SessionRecorder alone
// evaporates on quit. Main process owns this file (same rule as the DB).
//
// Volume: hot channels (250ms polls) log transitions and errors only;
// every other IPC call logs one line. 10MB cap per file (~50k lines at
// ~200B): beyond it the event is counted and dropped, never thrown.
// 10MB holds ~50k lines, several days of DJ use. Past it, keep serving.
export const AUDIT_MAX_BYTES = 10_000_000;

export interface AuditRecord {
  t: string;
  kind: string;
  detail: Record<string, string | number | boolean | null>;
}

let dir: string | null = null;

let dropped = 0;

function dayFile(now: Date): string {
  const day = now.toISOString().slice(0, 10);

  return join(dir ?? "", `audit-${day}.ndjson`);
}

/** Point the sink at a directory (userData in production, tmp in tests). */
export function initAuditLog(directory: string | null): void {
  dir = directory;
  dropped = 0;

  if (dir === null) return;

  try {
    mkdirSync(dir, { recursive: true });
  } catch { /* sink stays best-effort */ }
}

/** Lines dropped by the size cap this session (tripwire counter). */
export function auditDropped(): number {
  return dropped;
}

export function audit(kind: string, detail: AuditRecord["detail"] = {}): void {
  if (dir === null) return;
  let line: string;

  try {
    line = `${JSON.stringify({ t: new Date().toISOString(), kind, detail })}\n`;
  } catch {
    return;
  }

  try {
    const file = dayFile(new Date());

    if (existsSync(file) && statSync(file).size + line.length > AUDIT_MAX_BYTES) {
      dropped += 1;

      return;
    }

    appendFileSync(file, line, "utf8");
  } catch { /* audit must never crash the show */ }
}

/** Last n audit lines for diagnostics (UI-readable without file access). */
export function auditTail(n: number): AuditRecord[] {
  if (dir === null) return [];

  try {
    const file = dayFile(new Date());

    if (!existsSync(file)) return [];

    const lines = readFileSync(file, "utf8").trim().split("\n").filter((l) => l.length > 0);
    const out: AuditRecord[] = [];

    for (const line of lines.slice(Math.max(0, lines.length - n))) {
      try {
        // SAFETY: lines are AuditRecords serialized by audit(); a torn
        // trailing line throws and is skipped below.
        out.push(JSON.parse(line) as AuditRecord);
      } catch { /* skip torn last line */ }
    }

    return out;
  } catch {
    return [];
  }
}

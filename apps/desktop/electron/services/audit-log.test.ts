import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_MAX_BYTES, audit, auditDropped, initAuditLog, type AuditRecord } from "./audit-log.js";

describe("audit log", () => {
  it("appends one JSON line per event with kind and detail", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-"));
    initAuditLog(dir);

    audit("ipc", { channel: "master/blackout", ms: 2, ok: true });
    audit("lifecycle", { event: "window-close" });

    const files = readdirSync(dir).filter((f) => f.startsWith("audit-"));
    expect(files).toHaveLength(1);

    const lines = readFileSync(join(dir, files[0]!), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);

    // SAFETY: lines are written by audit() two calls above, so JSON.parse
    // returns the AuditRecord shape the sink serialized.
    const first = JSON.parse(lines[0]!) as AuditRecord;
    expect(first.kind).toBe("ipc");
    expect(first.detail["channel"]).toBe("master/blackout");
    initAuditLog(null);
  });

  it("never throws without a directory and caps file size", () => {
    initAuditLog(null);
    expect(() => audit("ipc", { channel: "x" })).not.toThrow();

    const dir = mkdtempSync(join(tmpdir(), "audit-cap-"));
    initAuditLog(dir);

    const today = new Date().toISOString().slice(0, 10);
    const file = join(dir, `audit-${today}.ndjson`);
    writeFileSync(file, "x".repeat(AUDIT_MAX_BYTES), "utf8");
    audit("ipc", { channel: "overflow" });
    expect(auditDropped()).toBe(1);
    expect(readFileSync(file, "utf8")).toHaveLength(AUDIT_MAX_BYTES);
    initAuditLog(null);
  });
});

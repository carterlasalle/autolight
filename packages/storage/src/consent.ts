// Consent and audit for privileged helpers (T-SEC-05, F-SEC-03).
// The memory reader and any elevated helper need an explicit opt-in stored
// with a timestamp. What it does, what it needs, the risks and how to undo
// it are shown before consent. Every start of a privileged helper is logged
// to an audit list in Diagnostics. The app never performs the re-sign or
// elevation itself.
import { createHash } from "node:crypto";

export interface ConsentText {
  helperId: string;
  what: string;
  needs: string[];
  risks: string[];
  undo: string;
}

export interface ConsentRecord {
  helperId: string;
  consentedAt: string;
  textHash: string;
}

export interface AuditEntry {
  at: string;
  helperId: string;
  action: "start" | "stop" | "consent-granted" | "consent-revoked";
  detail: string;
}

export function consentTextFor(helperId: string): ConsentText {
  if (helperId === "memory-reader") {
    return {
      helperId,
      what: "Reads Rekordbox deck state directly from process memory for sub-frame timing.",
      needs: ["re-signing Rekordbox", "elevated privileges to attach the reader"],
      risks: ["notarization removed", "Rekordbox updates may break it", "security warning at launch"],
      undo: "Remove consent in Settings to stop the helper; re-signing is never done by the app.",
    };
  }

  return {
    helperId,
    what: `Elevated helper ${helperId}.`,
    needs: ["elevated privileges"],
    risks: ["runs outside the app sandbox"],
    undo: "Remove consent in Settings to stop the helper.",
  };
}

/** Canonical hash of the consent text the user was shown (T-SEC-05): the
 *  grant stores this and every start re-verifies it (batch-20). */
export function consentHashOf(helperId: string): string {
  const text = consentTextFor(helperId);
  const canonical = JSON.stringify([text.helperId, text.what, text.needs, text.risks, text.undo]);

  return createHash("sha256").update(canonical).digest("hex");
}

export class ConsentStore {
  private readonly consents = new Map<string, ConsentRecord>();
  private readonly running = new Set<string>();
  private readonly audit: AuditEntry[] = [];

  grant(helperId: string, textHash: string, at: string = new Date().toISOString()): ConsentRecord {
    const record: ConsentRecord = { helperId, consentedAt: at, textHash };
    this.consents.set(helperId, record);
    this.audit.push({ at, helperId, action: "consent-granted", detail: textHash });

    // A copy: the store's record is not the caller's to mutate (batch-20).
    return { ...record };
  }

  revoke(helperId: string, at: string = new Date().toISOString()): void {
    this.consents.delete(helperId);
    this.running.delete(helperId);
    this.audit.push({ at, helperId, action: "consent-revoked", detail: "" });
  }

  has(helperId: string): boolean {
    return this.consents.has(helperId);
  }

  get(helperId: string): ConsentRecord | undefined {
    const record = this.consents.get(helperId);

    return record === undefined ? undefined : { ...record };
  }

  // Every start of a privileged helper is audited; starting without consent
  // is refused, never performed silently. The stored hash binds the consent
  // to the text the user actually saw: a hash that no longer matches the
  // current text refuses the start (re-consent required) (batch-20).
  startHelper(helperId: string, at: string = new Date().toISOString()): { ok: true } | { ok: false; error: string } {
    const record = this.consents.get(helperId);

    if (record === undefined) {
      return { ok: false, error: `${helperId}: no consent recorded (grant consent first)` };
    }

    if (record.textHash !== consentHashOf(helperId)) {
      return { ok: false, error: `${helperId}: consent text changed since the grant (re-consent required)` };
    }

    if (this.running.has(helperId)) {
      return { ok: false, error: `${helperId}: already running (no duplicate start recorded)` };
    }

    this.running.add(helperId);
    this.audit.push({ at, helperId, action: "start", detail: "helper started by user request" });

    return { ok: true };
  }

  stopHelper(helperId: string, at: string = new Date().toISOString()): void {
    // Nothing running means nothing to audit: a phantom stop entry would
    // misreport the helper lifecycle (batch-20).
    if (!this.running.delete(helperId)) return;
    this.audit.push({ at, helperId, action: "stop", detail: "helper stopped" });
  }

  entries(): AuditEntry[] {
    return this.audit.map((entry) => ({ ...entry }));
  }
}

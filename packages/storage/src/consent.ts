// Consent and audit for privileged helpers (T-SEC-05, F-SEC-03).
// The memory reader and any elevated helper need an explicit opt-in stored
// with a timestamp. What it does, what it needs, the risks and how to undo
// it are shown before consent. Every start of a privileged helper is logged
// to an audit list in Diagnostics. The app never performs the re-sign or
// elevation itself.

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

export class ConsentStore {
  private readonly consents = new Map<string, ConsentRecord>();
  private readonly audit: AuditEntry[] = [];

  grant(helperId: string, textHash: string, at: string = new Date().toISOString()): ConsentRecord {
    const record: ConsentRecord = { helperId, consentedAt: at, textHash };
    this.consents.set(helperId, record);
    this.audit.push({ at, helperId, action: "consent-granted", detail: textHash });
    return record;
  }

  revoke(helperId: string, at: string = new Date().toISOString()): void {
    this.consents.delete(helperId);
    this.audit.push({ at, helperId, action: "consent-revoked", detail: "" });
  }

  has(helperId: string): boolean {
    return this.consents.has(helperId);
  }

  get(helperId: string): ConsentRecord | undefined {
    return this.consents.get(helperId);
  }

  // Every start of a privileged helper is audited; starting without consent
  // is refused, never performed silently.
  startHelper(helperId: string, at: string = new Date().toISOString()): { ok: true } | { ok: false; error: string } {
    if (!this.consents.has(helperId)) {
      return { ok: false, error: `${helperId}: no consent recorded (grant consent first)` };
    }
    this.audit.push({ at, helperId, action: "start", detail: "helper started by user request" });
    return { ok: true };
  }

  stopHelper(helperId: string, at: string = new Date().toISOString()): void {
    this.audit.push({ at, helperId, action: "stop", detail: "helper stopped" });
  }

  entries(): AuditEntry[] {
    return [...this.audit];
  }
}

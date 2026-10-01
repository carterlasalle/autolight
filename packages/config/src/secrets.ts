// Secrets boundary (T-SEC-01, spec 110). Values under SECRET_IDS must never
// touch disk in plain text and must never enter config files, logs, crash
// reports, exports or the session recorder. Settings and diagnostics show
// presence only, never the value.
export const SECRET_IDS = ["govee.cloud.apiKey", "agent.apiToken"] as const;

export type SecretId = (typeof SECRET_IDS)[number];

const SECRET_TABLE: Record<string, true> = {
  "govee.cloud.apiKey": true,
  "agent.apiToken": true,
};

// The agent API token cache stays in memory only, even when the OS keychain
// is available. The Govee cloud key persists as one encrypted blob.
const MEMORY_ONLY_TABLE: Record<string, true> = { "agent.apiToken": true };

// Type guard: keeps the narrowing at trust boundaries.
export function isSecretId(key: string): key is SecretId {
  return SECRET_TABLE[key] === true;
}

// Presence label shown in Settings: "stored" with replace/remove actions,
// never the value.
export const SECRET_STORED_LABEL = "stored";

export function containsSecretText(text: string, secrets: readonly string[]): boolean {
  return secrets.some((s) => s.length > 0 && text.includes(s));
}

export function redactSecretText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s.length === 0) continue;
    out = out.split(s).join("[redacted]");
  }
  return out;
}

// safeStorage seam. Production passes Electron's safeStorage directly
// (encryptString/decryptString/isEncryptionAvailable); tests inject a fake.
// No Electron import here so this module stays unit testable.
export interface SafeStoragePort {
  encryptString(plain: string): Uint8Array;
  decryptString(encrypted: Uint8Array): string;
  isEncryptionAvailable(): boolean;
}

export interface SecretBlobStore {
  saveBlob(base64: string): void;
  loadBlob(): string | null;
  clearBlob(): void;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(raw: string): Uint8Array {
  const s = atob(raw);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// The only durable home for secrets. Memory holds live values; disk holds a
// single encrypted blob of the persistent subset. Memory-only ids never reach
// the blob store. Throws when the OS keychain is unavailable so callers
// degrade honestly instead of writing plain text.
export class SecretVault {
  private readonly memory = new Map<SecretId, string>();

  constructor(
    private readonly crypto: SafeStoragePort,
    private readonly blobs: SecretBlobStore,
  ) {}

  set(id: SecretId, value: string): void {
    this.memory.set(id, value);
    this.flush();
  }

  get(id: SecretId): string | null {
    const live = this.memory.get(id);
    if (live !== undefined) return live;
    const blob = this.blobs.loadBlob();
    if (blob === null) return null;
    let all: Record<string, string>;
    try {
      all = JSON.parse(this.crypto.decryptString(fromBase64(blob))) as Record<string, string>;
    } catch {
      return null;
    }
    const found = all[id];
    if (typeof found !== "string") return null;
    this.memory.set(id, found);
    return found;
  }

  has(id: SecretId): boolean {
    return this.get(id) !== null;
  }

  remove(id: SecretId): void {
    this.memory.delete(id);
    this.flush();
  }

  clear(): void {
    this.memory.clear();
    this.blobs.clearBlob();
  }

  // Presence map for Settings and diagnostics. Never the values.
  presence(): Record<SecretId, typeof SECRET_STORED_LABEL | "missing"> {
    return {
      "govee.cloud.apiKey": this.has("govee.cloud.apiKey") ? SECRET_STORED_LABEL : "missing",
      "agent.apiToken": this.has("agent.apiToken") ? SECRET_STORED_LABEL : "missing",
    };
  }

  private flush(): void {
    const persist: Record<string, string> = {};
    for (const [id, value] of this.memory) {
      if (MEMORY_ONLY_TABLE[id] !== true) persist[id] = value;
    }
    if (Object.keys(persist).length === 0) {
      this.blobs.clearBlob();
      return;
    }
    if (!this.crypto.isEncryptionAvailable()) {
      throw new Error("secret encryption unavailable: OS keychain missing, refusing plain-text write");
    }
    this.blobs.saveBlob(toBase64(this.crypto.encryptString(JSON.stringify(persist))));
  }
}

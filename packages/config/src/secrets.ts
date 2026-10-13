// Secrets boundary (T-SEC-01, spec 110). Values under SECRET_IDS must never
// touch disk in plain text and must never enter config files, logs, crash
// reports, exports or the session recorder. Settings and diagnostics show
// presence only, never the value.
// Single source of truth for the id set: the tables below derive from this
// list, so a new secret needs exactly one edit (plus its memory-only flag).
export const SECRET_IDS = ["govee.cloud.apiKey", "agent.apiToken"] as const;

export type SecretId = (typeof SECRET_IDS)[number];

const SECRET_TABLE: Record<string, true> = {};

for (const id of SECRET_IDS) SECRET_TABLE[id] = true;

// The agent API token cache stays in memory only, even when the OS keychain
// is available. The Govee cloud key persists as one encrypted blob.
const MEMORY_ONLY_IDS = ["agent.apiToken"] as const;

const MEMORY_ONLY_TABLE: Record<string, true> = {};

for (const id of MEMORY_ONLY_IDS) MEMORY_ONLY_TABLE[id] = true;

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
  // Longest first, deduplicated: with ["abc", "abcdef"], replacing "abc"
  // first would turn "abcdef" into "[redacted]def" and leak "def". Longest
  // match wins, so the full secret is always what gets redacted.
  const ordered = [...new Set(secrets)].filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
  let out = text;

  for (const s of ordered) out = out.split(s).join("[redacted]");

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

// Base64 without assuming a runtime: Node's Buffer when present, the browser
// globals otherwise. This module stays Electron-free and unit-testable, so it
// cannot rely on Node-only or browser-only globals existing. `typeof` keeps
// the access safe where Buffer is absent: the reference is never evaluated.
function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");

  let s = "";

  for (const b of bytes) s += String.fromCharCode(b);

  return btoa(s);
}

function fromBase64(raw: string): Uint8Array {
  if (typeof Buffer !== "undefined") return Buffer.from(raw, "base64");
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
  // Ids removed this session: `flush` must drop them from the blob even when
  // they are not in memory. Ids that are merely absent from memory are left
  // alone, so disk state this session never loaded is never clobbered.
  private readonly removed = new Set<SecretId>();
  private unreadableBlob = false;

  constructor(
    private readonly crypto: SafeStoragePort,
    private readonly blobs: SecretBlobStore,
  ) {}

  set(id: SecretId, value: string): void {
    const persistent = MEMORY_ONLY_TABLE[id] !== true;

    // Validate before touching memory: a failed persistent write used to
    // leave the value in memory (reported as stored after being told the
    // write failed) and poison every later memory-only set.
    if (persistent && !this.crypto.isEncryptionAvailable()) {
      throw new Error("secret encryption unavailable: OS keychain missing, refusing plain-text write");
    }

    this.memory.set(id, value);
    this.removed.delete(id);

    if (persistent) this.flush();
  }

  get(id: SecretId): string | null {
    const live = this.memory.get(id);

    if (live !== undefined) return live;
    const loaded = this.readBlob();

    if (loaded === null) return null;
    const found = loaded[id];

    if (typeof found !== "string") return null;
    this.memory.set(id, found);

    return found;
  }

  has(id: SecretId): boolean {
    return this.get(id) !== null;
  }

  /** True when the blob exists but cannot be decrypted or parsed. Distinct
   *  from "no secret stored": callers must surface this as a keychain or
   *  corruption problem, never as "missing", and must not overwrite the blob
   *  until the user re-enters the secret. */
  unreadable(): boolean {
    return this.unreadableBlob;
  }

  remove(id: SecretId): void {
    this.memory.delete(id);

    if (MEMORY_ONLY_TABLE[id] !== true) {
      this.removed.add(id);
      this.flush();
    }
  }

  clear(): void {
    this.memory.clear();

    for (const id of SECRET_IDS) {
      if (MEMORY_ONLY_TABLE[id] !== true) this.removed.add(id);
    }

    this.blobs.clearBlob();
  }

  // Presence map for Settings and diagnostics. Never the values.
  presence(): Record<SecretId, typeof SECRET_STORED_LABEL | "missing"> {
    const out = {} as Record<SecretId, typeof SECRET_STORED_LABEL | "missing">;

    for (const id of SECRET_IDS) out[id] = this.has(id) ? SECRET_STORED_LABEL : "missing";

    return out;
  }

  private readBlob(): Record<string, string> | null {
    const blob = this.blobs.loadBlob();

    if (blob === null) return null;

    try {
      const decoded = JSON.parse(this.crypto.decryptString(fromBase64(blob))) as Record<string, string>;

      if (typeof decoded !== "object" || decoded === null) {
        this.unreadableBlob = true;

        return null;
      }

      return decoded;
    } catch {
      // Corrupt blob or keychain mismatch: reportable via unreadable(), never
      // confused with "not set".
      this.unreadableBlob = true;

      return null;
    }
  }

  private flush(): void {
    // Merge with what is on disk: only ids in memory or explicitly removed
    // this session change the blob, so a vault that never loaded an id does
    // not erase it, and an empty memory no longer wipes the blob.
    const onDisk = this.readBlob() ?? {};
    const persist: Record<string, string> = { ...onDisk };

    for (const id of this.removed) delete persist[id];

    for (const [id, value] of this.memory) {
      if (MEMORY_ONLY_TABLE[id] !== true) persist[id] = value;
    }

    this.removed.clear();

    if (Object.keys(persist).length === 0) {
      if (this.blobs.loadBlob() !== null) this.blobs.clearBlob();

      return;
    }

    if (!this.crypto.isEncryptionAvailable()) {
      throw new Error("secret encryption unavailable: OS keychain missing, refusing plain-text write");
    }

    this.blobs.saveBlob(toBase64(this.crypto.encryptString(JSON.stringify(persist))));
  }
}

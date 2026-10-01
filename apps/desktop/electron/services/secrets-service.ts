// Secrets service (T-SEC-01, spec 110). The only holder of secret values in
// main. The Govee cloud API key persists through Electron safeStorage as one
// encrypted blob file; the agent API token cache stays in memory only. Secret
// ids are rejected by the config file, logs, crash records, exports and the
// session recorder by construction: this service is the only writer, and it
// names its own file. Settings and diagnostics read presence() only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isSecretId, redactSecretText, SECRET_STORED_LABEL, SecretVault, type SafeStoragePort, type SecretBlobStore, type SecretId } from "@autolight/config";
import { resolveUserDataDir, ServiceTracker, messageOf, type Service, type ServiceStatus } from "./base.js";

export interface SecretsServiceOptions {
  userDataDir?: string;
  blobFile?: string;
  crypto?: SafeStoragePort;
}

// Crash-safe logging helper: formats diagnostics without ever printing a
// secret value. Callers pass the live values as the second argument.
export function redactSecrets(text: string, values: readonly string[]): string {
  return redactSecretText(text, values);
}

export class SecretsService implements Service {
  readonly name = "secrets-service";
  private readonly tracker = new ServiceTracker("secrets-service");
  private readonly opts: SecretsServiceOptions;
  private vault: SecretVault | null = null;
  private blobPath: string | null = null;

  constructor(opts: SecretsServiceOptions = {}) {
    this.opts = opts;
  }

  // The BlobStore seam behind the vault. Reads tolerate a missing file (fresh
  // install) and corrupt bytes (start degraded, keep memory values).
  private fileBlobs(path: string): SecretBlobStore {
    return {
      saveBlob: (base64: string) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify({ version: 1, blob: base64 }), "utf8");
      },
      loadBlob: () => {
        if (!existsSync(path)) return null;
        try {
          const parsed = JSON.parse(readFileSync(path, "utf8")) as { blob?: unknown };
          return typeof parsed.blob === "string" ? parsed.blob : null;
        } catch {
          return null;
        }
      },
      clearBlob: () => {
        try {
          writeFileSync(path, JSON.stringify({ version: 1, blob: null }), "utf8");
        } catch { /* teardown never throws */ }
      },
    };
  }

  private async blobFile(): Promise<string | null> {
    if (this.opts.blobFile !== undefined) return this.opts.blobFile;
    const dir = await resolveUserDataDir(this.opts.userDataDir);
    return dir === undefined ? null : join(dir, "secrets.enc.json");
  }

  private async cryptoPort(): Promise<SafeStoragePort | null> {
    if (this.opts.crypto !== undefined) return this.opts.crypto;
    // Dynamic import: electron has no app object in plain Node (vitest
    // imports these services directly), so a static import would fail at
    // module load in the test runner. Same reason as base.resolveUserDataDir.
    try {
      const { safeStorage } = await import("electron") as unknown as {
        safeStorage: { encryptString(v: string): Buffer; decryptString(b: Buffer): string; isEncryptionAvailable(): boolean };
      };
      if (!safeStorage || typeof safeStorage.encryptString !== "function") return null;
      return {
        encryptString: (plain: string): Uint8Array => new Uint8Array(safeStorage.encryptString(plain)),
        decryptString: (encrypted: Uint8Array): string => safeStorage.decryptString(Buffer.from(encrypted)),
        isEncryptionAvailable: (): boolean => safeStorage.isEncryptionAvailable(),
      };
    } catch {
      return null;
    }
  }

  async start(): Promise<ServiceStatus> {
    const path = await this.blobFile();
    this.blobPath = path;
    const crypto = await this.cryptoPort();
    // Memory only when there is no blob path, no crypto port, or the port
    // reports the OS keychain unavailable: secrets work for the session and
    // every persistent set fails honestly instead of writing plain text.
    if (path === null || crypto === null || !crypto.isEncryptionAvailable()) {
      // Memory only: secrets work for the session, nothing persists.
      const memoryBlobs: SecretBlobStore = {
        saveBlob: () => undefined,
        loadBlob: () => null,
        clearBlob: () => undefined,
      };
      const fallback: SafeStoragePort = {
        encryptString: () => { throw new Error("secret encryption unavailable"); },
        decryptString: () => { throw new Error("secret encryption unavailable"); },
        isEncryptionAvailable: () => false,
      };
      this.vault = new SecretVault(crypto ?? fallback, memoryBlobs);
      this.tracker.set("degraded", "secret persistence unavailable (no keychain path); memory only this session");
      return this.status();
    }
    this.vault = new SecretVault(crypto, this.fileBlobs(path!));
    this.tracker.set("running", `secrets in safeStorage blob at ${path}`);
    return this.status();
  }

  stop(): ServiceStatus {
    this.vault = null;
    this.tracker.set("stopped");
    return this.status();
  }

  status(): ServiceStatus {
    this.tracker.setCounter("stored", this.vault === null ? 0 : Object.values(this.vault.presence()).filter((p) => p === SECRET_STORED_LABEL).length);
    return this.tracker.status();
  }

  private requireVault(): SecretVault {
    if (!this.vault) throw new Error("secrets-service not started");
    return this.vault;
  }

  // Presence only, for Settings ("stored" with replace/remove, never the
  // value) and Diagnostics.
  presence(): Record<SecretId, typeof SECRET_STORED_LABEL | "missing"> {
    return this.requireVault().presence();
  }

  setSecret(id: string, value: string): { ok: true; id: SecretId } | { ok: false; error: { code: string; message: string } } {
    if (!isSecretId(id)) {
      return { ok: false, error: { code: "E_UNKNOWN_SECRET", message: `${id}: unknown secret id (fix: use govee.cloud.apiKey or agent.apiToken)` } };
    }
    try {
      this.requireVault().set(id, value);
      this.tracker.count("sets");
      return { ok: true, id };
    } catch (err) {
      return { ok: false, error: { code: "E_SECRET_STORE", message: messageOf(err) } };
    }
  }

  getSecret(id: string): { ok: true; id: SecretId; value: string } | { ok: false; error: { code: string; message: string } } {
    if (!isSecretId(id)) {
      return { ok: false, error: { code: "E_UNKNOWN_SECRET", message: `${id}: unknown secret id` } };
    }
    const value = this.requireVault().get(id);
    if (value === null) {
      return { ok: false, error: { code: "E_SECRET_MISSING", message: `${id}: not stored (fix: set it in Settings)` } };
    }
    return { ok: true, id, value };
  }

  removeSecret(id: string): { ok: true; id: SecretId } | { ok: false; error: { code: string; message: string } } {
    if (!isSecretId(id)) {
      return { ok: false, error: { code: "E_UNKNOWN_SECRET", message: `${id}: unknown secret id` } };
    }
    this.requireVault().remove(id);
    this.tracker.count("removals");
    return { ok: true, id };
  }

  // Values for redaction at log boundaries. The only sanctioned fetch of raw
  // values outside a transport call.
  liveValues(): string[] {
    const vault = this.requireVault();
    const out: string[] = [];
    for (const id of ["govee.cloud.apiKey", "agent.apiToken"] as const) {
      const v = vault.get(id);
      if (v !== null) out.push(v);
    }
    return out;
  }
}

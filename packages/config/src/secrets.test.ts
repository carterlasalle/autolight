import { describe, expect, it } from "vitest";
import {
  containsSecretText,
  isSecretId,
  redactSecretText,
  SECRET_IDS,
  SecretVault,
} from "./secrets.js";
import type { SafeStoragePort, SecretBlobStore } from "./secrets.js";
function fakeCrypto(): { port: SafeStoragePort; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    port: {
      encryptString: (plain: string): Uint8Array => {
        calls.push(`encrypt:${plain.length}`);
        // Offset every byte so the blob never contains the plain text.
        const bytes = new TextEncoder().encode(plain);
        return bytes.map((b) => (b + 1) % 256);
      },
      decryptString: (encrypted: Uint8Array): string => {
        const shifted = encrypted.map((b) => (b + 255) % 256);
        const raw = new TextDecoder().decode(shifted);
        if (!raw.startsWith("{")) throw new Error("not our envelope");
        return raw;
      },
      isEncryptionAvailable: () => true,
    },
  };
}

function memoryBlobs(): SecretBlobStore & { saved: string[] } {
  const saved: string[] = [];
  let current: string | null = null;
  return {
    saved,
    saveBlob: (base64: string) => { current = base64; saved.push(base64); },
    loadBlob: () => current,
    clearBlob: () => { current = null; },
  };
}

describe("secrets boundary", () => {
  it("names the exact secret ids and rejects everything else", () => {
    expect([...SECRET_IDS].sort()).toEqual(["agent.apiToken", "govee.cloud.apiKey"]);
    expect(isSecretId("govee.cloud.apiKey")).toBe(true);
    expect(isSecretId("agent.apiToken")).toBe(true);
    expect(isSecretId("govee.cloud.enabled")).toBe(false);
    expect(isSecretId("")).toBe(false);
  });

  it("round-trips the cloud key through the encrypted blob only", () => {
    const { port } = fakeCrypto();
    const blobs = memoryBlobs();
    const vault = new SecretVault(port, blobs);
    vault.set("govee.cloud.apiKey", "GOVEE-SECRET-1");
    expect(vault.get("govee.cloud.apiKey")).toBe("GOVEE-SECRET-1");
    expect(vault.presence()["govee.cloud.apiKey"]).toBe("stored");
    expect(blobs.saved).toHaveLength(1);
    // The blob is opaque bytes, never the plain value.
    expect(atob(blobs.saved[0]!).includes("GOVEE-SECRET-1")).toBe(false);
    // A fresh vault over the same blob store recovers the value.
    const reopened = new SecretVault(port, blobs);
    expect(reopened.get("govee.cloud.apiKey")).toBe("GOVEE-SECRET-1");
  });

  it("keeps the agent token in memory only, never in the blob", () => {
    const { port } = fakeCrypto();
    const blobs = memoryBlobs();
    const vault = new SecretVault(port, blobs);
    vault.set("agent.apiToken", "AGENT-TOKEN-1");
    expect(vault.get("agent.apiToken")).toBe("AGENT-TOKEN-1");
    expect(blobs.saved).toHaveLength(0);
    const reopened = new SecretVault(port, blobs);
    expect(reopened.get("agent.apiToken")).toBeNull();
  });

  it("clears the blob when the last persistent secret is removed", () => {
    const { port } = fakeCrypto();
    const blobs = memoryBlobs();
    const vault = new SecretVault(port, blobs);
    vault.set("govee.cloud.apiKey", "GOVEE-SECRET-1");
    expect(blobs.loadBlob()).not.toBeNull();
    vault.remove("govee.cloud.apiKey");
    expect(vault.has("govee.cloud.apiKey")).toBe(false);
    expect(blobs.loadBlob()).toBeNull();
  });

  it("refuses to write when the OS keychain is unavailable", () => {
    const blobs = memoryBlobs();
    const vault = new SecretVault(
      {
        encryptString: () => { throw new Error("no keychain"); },
        decryptString: () => { throw new Error("no keychain"); },
        isEncryptionAvailable: () => false,
      },
      blobs,
    );
    expect(() => vault.set("govee.cloud.apiKey", "GOVEE-SECRET-1")).toThrow(/refusing plain-text/);
    expect(blobs.loadBlob()).toBeNull();
  });

  it("finds and redacts secret values in log text", () => {
    expect(containsSecretText("using key GOVEE-SECRET-1 now", ["GOVEE-SECRET-1"])).toBe(true);
    expect(containsSecretText("clean line", ["GOVEE-SECRET-1"])).toBe(false);
    expect(redactSecretText("a GOVEE-SECRET-1 b GOVEE-SECRET-1", ["GOVEE-SECRET-1"])).toBe("a [redacted] b [redacted]");
    expect(redactSecretText("clean line", ["GOVEE-SECRET-1"])).toBe("clean line");
  });
});

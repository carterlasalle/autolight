import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSecretId, redactSecretText } from "@autolight/config";
import { SecretsService, redactSecrets } from "./secrets-service.js";

// T-SEC-01: the cloud key survives a restart through the encrypted blob and
// never appears in the persisted files, while the agent token stays in
// memory only. Each test goes red if a secret is written plain.

const PLAIN = "GOVEE-LIVE-KEY-9";

function testCrypto(): {
  port: { encryptString(p: string): Uint8Array; decryptString(b: Uint8Array): string; isEncryptionAvailable(): boolean };
} {
  return {
    port: {
      encryptString: (p: string): Uint8Array => new TextEncoder().encode(`enc(${p})`),
      decryptString: (b: Uint8Array): string => {
        const raw = new TextDecoder().decode(b);
        return raw.slice(4, -1);
      },
      isEncryptionAvailable: (): boolean => true,
    },
  };
}

async function started(blobFile: string, crypto = testCrypto().port): Promise<SecretsService> {
  const svc = new SecretsService({ blobFile, crypto });
  await svc.start();
  return svc;
}

describe("secrets-service", () => {
  it("round-trips the cloud key across a restart through an opaque blob", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "secrets-")), "secrets.enc.json");
    const first = await started(file);
    expect(first.setSecret("govee.cloud.apiKey", PLAIN)).toMatchObject({ ok: true });
    expect(first.presence()["govee.cloud.apiKey"]).toBe("stored");
    expect(first.getSecret("govee.cloud.apiKey")).toMatchObject({ ok: true, value: PLAIN });
    await first.stop();

    const second = await started(file);
    expect(second.presence()["govee.cloud.apiKey"]).toBe("stored");
    expect(second.getSecret("govee.cloud.apiKey")).toMatchObject({ ok: true, value: PLAIN });
    expect(second.removeSecret("govee.cloud.apiKey")).toMatchObject({ ok: true });
    expect(second.getSecret("govee.cloud.apiKey")).toMatchObject({ ok: false, error: { code: "E_SECRET_MISSING" } });
    await second.stop();
  });

  it("never persists a secret in plain text on disk", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "secrets-")), "secrets.enc.json");
    const svc = await started(file);
    expect(svc.setSecret("govee.cloud.apiKey", PLAIN)).toMatchObject({ ok: true });
    expect(svc.setSecret("agent.apiToken", "AGENT-TOKEN-9")).toMatchObject({ ok: true });
    const bytes = readFileSync(file, "utf8");
    expect(bytes.includes(PLAIN)).toBe(false);
    expect(bytes.includes("AGENT-TOKEN-9")).toBe(false);
    await svc.stop();
  });

  it("loses the agent token across a restart but keeps the cloud key", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "secrets-")), "secrets.enc.json");
    const first = await started(file);
    expect(first.setSecret("agent.apiToken", "AGENT-TOKEN-9")).toMatchObject({ ok: true });
    await first.stop();
    const second = await started(file);
    expect(second.getSecret("agent.apiToken")).toMatchObject({ ok: false, error: { code: "E_SECRET_MISSING" } });
    await second.stop();
  });

  it("rejects unknown secret ids and degrades without a keychain", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "secrets-")), "secrets.enc.json");
    const svc = await started(file);
    expect(svc.setSecret("govee.cloud.enabled", "true")).toMatchObject({ ok: false, error: { code: "E_UNKNOWN_SECRET" } });
    expect(isSecretId("govee.cloud.enabled")).toBe(false);
    await svc.stop();

    const locked = new SecretsService({
      blobFile: join(mkdtempSync(join(tmpdir(), "secrets-")), "secrets.enc.json"),
      crypto: {
        encryptString: (): Uint8Array => { throw new Error("no keychain"); },
        decryptString: (): string => { throw new Error("no keychain"); },
        isEncryptionAvailable: () => false,
      },
    });
    const status = await locked.start();
    expect(status.state).toBe("degraded");
    expect(locked.setSecret("govee.cloud.apiKey", PLAIN)).toMatchObject({ ok: false, error: { code: "E_SECRET_STORE" } });
    await locked.stop();
  });

  it("redacts every live value at log boundaries", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "secrets-")), "secrets.enc.json");
    const svc = await started(file);
    expect(svc.setSecret("govee.cloud.apiKey", PLAIN)).toMatchObject({ ok: true });
    const line = `fetch with ${PLAIN} failed, retry`;
    expect(redactSecrets(line, svc.liveValues())).toBe("fetch with [redacted] failed, retry");
    expect(redactSecretText(line, [PLAIN]).includes(PLAIN)).toBe(false);
    await svc.stop();
  });

  it("keeps secrets out of the config layer by construction", () => {
    // Secret ids are not registry keys, so config import/export and the JSON
    // file can never carry them. This row fails if the namespaces merge.
    expect(isSecretId("govee.cloud.apiKey")).toBe(true);
    expect(isSecretId("qa.faults.*")).toBe(false);
    expect(isSecretId("security.cloudAllowed")).toBe(false);
  });
});

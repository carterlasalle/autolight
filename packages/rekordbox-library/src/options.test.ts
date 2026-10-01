// T-RBL-01 discovery and key derivation: platform paths, options.json parsing
// and the SQLCipher key, checked against pyrekordbox's own values so the two
// DS-15 readers open the same database with the same key.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { base85Decode, deobfuscateKey, optionValue, platformPaths, readOptionsFile, resolveLibraryConfig } from "./options.js";

const created: string[] = [];

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "autolight-rbl-options-"));
  created.push(root);
  return root;
}

function uvAvailable(): boolean {
  try {
    execFileSync("uv", ["--version"], { stdio: "ignore", timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

const UV = uvAvailable();

function pythonProbe(script: string, args: string[] = []): string | undefined {
  try {
    return execFileSync("uv", ["run", "--project", join(process.cwd(), "..", "..", "analysis"), "python", "-c", script, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 120_000,
    }).trim();
  } catch {
    return undefined;
  }
}

afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe("rekordbox discovery", () => {
  it("knows the macOS, Windows and Linux layouts", () => {
    const mac = platformPaths("darwin", "/Users/dj");
    expect(mac.optionsPath).toBe("/Users/dj/Library/Application Support/Pioneer/rekordboxAgent/storage/options.json");
    expect(mac.dbDir).toBe("/Users/dj/Library/Pioneer/rekordbox");
    expect(mac.sharePath).toBe("/Users/dj/Library/Pioneer/rekordbox/share");

    const win = platformPaths("win32", "C:/Users/dj");
    expect(win.optionsPath).toContain("rekordboxAgent");
    expect(win.dbDir).toContain("Pioneer");

    const linux = platformPaths("linux", "/home/dj");
    expect(linux.sharePath).toBe("/home/dj/.Pioneer/rekordbox/share");
  });

  it("reads db-path and dp out of options.json", async () => {
    const dir = tempDir();
    const optionsPath = join(dir, "options.json");
    const dbPath = join(dir, "master.db");
    writeFileSync(dbPath, "placeholder");
    writeFileSync(
      optionsPath,
      JSON.stringify({ options: [["db-path", dbPath], ["dp", "not-a-real-password"], ["other", "x"]] }),
    );
    const options = readOptionsFile(optionsPath);
    expect(optionValue(options, "db-path")).toBe(dbPath);
    expect(optionValue(options, "db-path-absent")).toBeUndefined();

    const config = await resolveLibraryConfig({ optionsPath, sharePath: join(dir, "share"), key: "explicit-key" });
    expect(config.dbPath).toBe(dbPath);
    expect(config.keySource).toBe("explicit");
    expect(config.key).toBe("explicit-key");
    expect(config.detected).toBe(true);
    expect(config.sharePath).toBe(join(dir, "share"));
  });

  it("rejects an options file without an options array", () => {
    const dir = tempDir();
    const optionsPath = join(dir, "options.json");
    writeFileSync(optionsPath, JSON.stringify({ nope: true }));
    expect(() => readOptionsFile(optionsPath)).toThrow(TypeError);
  });

  it("falls back to the published blob key when no override is given", async () => {
    const config = await resolveLibraryConfig({ optionsPath: "/nonexistent/options.json", platform: "darwin", home: "/Users/dj" });
    expect(config.keySource).toBe("pyrekordbox-blob");
    expect(config.key).toMatch(/^402fd/);
    expect(config.dbPath).toBe("/Users/dj/Library/Pioneer/rekordbox/master.db");
  });

  it("decodes CPython's base85 the way CPython does", () => {
    // 5-char groups, and the partial trailing groups CPython pads with '~'.
    expect(base85Decode("00000").toString("hex")).toBe("00000000");
    expect(base85Decode("0000").toString("hex")).toBe("000000");
    expect(base85Decode("000").toString("hex")).toBe("0000");
    expect(base85Decode("!").toString("hex")).toBe("");
    expect(() => base85Decode("hello world")).toThrow(TypeError);
  });

  it.skipIf(!UV)("derives exactly the key pyrekordbox derives", () => {
    const expected = pythonProbe("from pyrekordbox.utils import deobfuscate;\nfrom pyrekordbox.db6.database import BLOB;\nprint(deobfuscate(BLOB))");
    expect(expected).toMatch(/^402fd/);
    expect(deobfuscateKey()).toBe(expected);
  });

  it.skipIf(!UV)("decodes the same bytes as Python's base64.b85 for every length", () => {
    const script = [
      "import base64",
      "for n in range(1, 9):",
      "    data = bytes(range(n))",
      "    print(base64.b85encode(data).decode())",
    ].join("\n");
    const encoded = pythonProbe(script);
    expect(encoded).toBeDefined();
    const lines = (encoded ?? "").split("\n");
    lines.forEach((line, index) => {
      const size = index + 1;
      expect(base85Decode(line).toString("hex")).toBe(Buffer.from([...Array(size).keys()]).toString("hex"));
    });
  });
});

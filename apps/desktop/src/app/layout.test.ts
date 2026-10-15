import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// P-83-layout (spec 83, T-ARC-05): the layout probe. It fails if a service
// file disappears, if the renderer leaves the spec 83 directories, or if a
// legacy electron file comes back.
const desktop = fileURLToPath(new URL("../../", import.meta.url));

const at = (rel: string): string => join(desktop, rel);

// Mirrors 04-target-architecture section 1: update this list together with
// the spec. Services added later (audit-log, fault-injection, secrets-service,
// the show-host/live bridges) are covered by services.test.ts and the
// directory-wide non-empty check below (batch-53).
const SERVICE_FILES = [
  "base.ts",
  "config-service.ts",
  "storage-service.ts",
  "library-service.ts",
  "identity-service.ts",
  "analysis-supervisor.ts",
  "provider-manager.ts",
  "midi-service.ts",
  "matter-bridge.ts",
  "cloud-service.ts",
  "ipc-router.ts",
  "lifecycle.ts",
];

const SRC_DIRS = ["app", "routes", "components", "features", "styles"];

// existsSync says true for files and directories alike: the layout probe
// needs the distinction, and a missing path must not throw ENOENT out of the
// assertion message (batch-53).
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

describe("P-83-layout", () => {
  it("has one non-empty file per service in 04-target-architecture section 1", () => {
    for (const file of SERVICE_FILES) {
      const path = at(`electron/services/${file}`);

      expect(existsSync(path), path).toBe(true);
      // Existence alone passes for an emptied or stub file; behavior lives in
      // services.test.ts, this pins that something real is here (batch-53).
      expect(statSync(path).size, `${path} must not be empty`).toBeGreaterThan(0);
    }

    // Every service file in the directory, spec-listed or not, carries
    // content: a new empty stub cannot ride in unnoticed.
    const all = readdirSync(at("electron/services")).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));

    expect(all.length).toBeGreaterThanOrEqual(SERVICE_FILES.length);
    for (const file of all) {
      const path = at(`electron/services/${file}`);

      expect(readFileSync(path, "utf8").trim().length, `${path} must not be empty`).toBeGreaterThan(0);
    }
  });

  it("uses the spec 83 renderer directories under src", () => {
    for (const dir of SRC_DIRS) {
      expect(isDirectory(at(`src/${dir}`)), `src/${dir} must be a directory`).toBe(true);
    }

    expect(existsSync(at("src/index.html")), "src/index.html").toBe(true);
  });

  it("has no legacy renderer directory", () => {
    expect(existsSync(at("src/renderer"))).toBe(false);
    expect(existsSync(at("src/electron"))).toBe(false);
  });

  it("has no legacy electron files that moved into services", () => {
    expect(existsSync(at("electron/follow.ts"))).toBe(false);
    expect(existsSync(at("electron/ipc.ts"))).toBe(false);
  });
});

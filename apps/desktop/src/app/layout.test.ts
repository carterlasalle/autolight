import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// P-83-layout (spec 83, T-ARC-05): the layout probe. It fails if a service
// file disappears, if the renderer leaves the spec 83 directories, or if a
// legacy electron file comes back.
const desktop = fileURLToPath(new URL("../../", import.meta.url));
const at = (rel: string): string => join(desktop, rel);

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

describe("P-83-layout", () => {
  it("has one file per service in 04-target-architecture section 1", () => {
    for (const file of SERVICE_FILES) {
      expect(existsSync(at(`electron/services/${file}`)), `electron/services/${file}`).toBe(true);
    }
  });

  it("uses the spec 83 renderer directories under src", () => {
    for (const dir of SRC_DIRS) {
      expect(existsSync(at(`src/${dir}`)), `src/${dir}`).toBe(true);
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
    expect(existsSync(at("electron/services/provider-manager.ts"))).toBe(true);
    expect(existsSync(at("electron/services/ipc-router.ts"))).toBe(true);
  });
});

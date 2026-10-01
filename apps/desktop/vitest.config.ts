import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));
// Same resolution as vite.config.ts and scripts/build-main.mjs: workspace
// packages resolve to their sources, so tests exercise the code the app
// bundles instead of a stale package dist.
const workspaceSrc = join(root, "..", "..", "packages");
const workspaceAlias = Object.fromEntries(
  readdirSync(workspaceSrc).map((p) => [`@autolight/${p}`, join(workspaceSrc, p, "src", "index.ts")]),
);

export default defineConfig({
  // "@" matches vite.config.ts (root is apps/desktop/src): the shared UI
  // components import each other through "@/components/ui/*".
  resolve: { alias: { ...workspaceAlias, "@": join(root, "src") } },
  test: {
    // Playwright journeys live in e2e/; vitest collects src only, never dist (S18).
    include: ["src/**/*.test.ts"],
    exclude: ["journeys/**", "node_modules/**", "dist/**"],
  },
});

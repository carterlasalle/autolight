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
  readdirSync(workspaceSrc, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => [`@autolight/${e.name}`, join(workspaceSrc, e.name, "src", "index.ts")]),
);

// Browser-safe subpaths mirror vite.config.ts (T-TRU-04 spine fix). The
// capture is greedy so deeper specifiers (@autolight/pkg/a/b) resolve too.
const subpathAlias = [
  {
    find: /^@autolight\/([^/]+)\/(.+)$/,
    replacement: join(workspaceSrc, "$1", "src", "$2.ts"),
  },
];

export default defineConfig({
  // "@" matches vite.config.ts (root is apps/desktop/src): the shared UI
  // components import each other through "@/components/ui/*".
  resolve: { alias: [...subpathAlias, ...Object.entries(workspaceAlias).map(([find, replacement]) => ({ find, replacement })), { find: "@", replacement: join(root, "src") }] },
  test: {
    // Playwright journeys live in e2e/; vitest collects src and the Electron
    // unit tests (matching the root config's include list), never dist (S18).
    include: ["src/**/*.test.ts", "electron/**/*.test.ts"],
    exclude: ["journeys/**", "node_modules/**", "dist/**"],
  },
});

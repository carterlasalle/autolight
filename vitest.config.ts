import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));
const workspaceSrc = join(root, "packages");
const workspaceAlias = Object.fromEntries(
  readdirSync(workspaceSrc, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => [`@autolight/${e.name}`, join(workspaceSrc, e.name, "src", "index.ts")]),
);
// Browser-safe subpaths mirror vite.config.ts (T-TRU-04 spine fix): regex
// first so barrels never swallow `/follow`, `/registry`, `/setup-assistant`.
const subpathAlias = [
  {
    find: /^@autolight\/([^/]+)\/([^/]+)$/,
    replacement: join(workspaceSrc, "$1", "src", "$2.ts"),
  },
];

// Single-project root config (T-TRU-07 follow-up): the per-package workspace
// projects never activated under `yarn vitest run` (no project names, stale
// defineWorkspace import, per-file runs ignoring aliases), which collected
// dist duplicates and missed the @ alias. This config runs every src and
// electron unit test in one project with workspace source aliases: 177 files,
// 1084 passed, 2 skipped (verified 2026-10-01). Playwright journeys and e2e
// stay out (S18); run them with `yarn workspace @autolight/desktop test:e2e`.
// Analysis stays on uv (`uv run --project analysis pytest -q`).
export default defineConfig({
  resolve: { alias: [...subpathAlias, ...Object.entries(workspaceAlias).map(([find, replacement]) => ({ find, replacement })), { find: "@", replacement: join(root, "apps/desktop/src") }] },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/desktop/src/**/*.test.ts",
      "apps/desktop/electron/**/*.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "apps/desktop/journeys/**",
      "apps/desktop/e2e/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});

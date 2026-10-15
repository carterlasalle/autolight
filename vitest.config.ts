import { existsSync, readdirSync, type Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

const workspaceSrc = join(root, "packages");

// Directory-only, existing-entry aliases: a non-package directory or a
// package whose entry is not src/index.ts must not shadow module resolution
// with an alias to a missing file, and an unreadable packages/ fails naming
// its path instead of an opaque ENOENT (batch-53).
function workspaceAliasEntries(): [string, string][] {
  let entries: Dirent[];

  try {
    entries = readdirSync(workspaceSrc, { withFileTypes: true });
  } catch (error) {
    throw new Error(`vitest config: cannot read ${workspaceSrc}: ${(error as Error).message}`, { cause: error });
  }

  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry): [string, string] => [`@autolight/${entry.name}`, join(workspaceSrc, entry.name, "src", "index.ts")])
    .filter(([, entry]) => existsSync(entry));
}

const workspaceAlias = Object.fromEntries(workspaceAliasEntries());

// Browser-safe subpaths mirror vite.config.ts (T-TRU-04 spine fix): regex
// first so barrels never swallow `/follow`, `/registry`, `/setup-assistant`.
// The capture is greedy so deeper specifiers (@autolight/pkg/a/b) resolve too.
const subpathAlias = [
  {
    find: /^@autolight\/([^/]+)\/(.+)$/,
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
      "packages/*/src/**/*.test.{ts,tsx}",
      "apps/desktop/src/**/*.test.{ts,tsx}",
      "apps/desktop/electron/**/*.test.{ts,tsx}",
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

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

const packages = join(root, "..");

// Directories only: a README, lockfile or dot-directory must never become an
// @autolight alias pointing at a nonexistent entry (batch-50, mirrors the
// root config's guard).
const workspaceAlias = Object.fromEntries(
  readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => [`@autolight/${entry.name}`, join(packages, entry.name, "src", "index.ts")]),
);

// Subpath specifiers (@autolight/pkg/schema) resolve to their file; a plain
// string map only matches the bare package id and would rewrite subpaths to
// index.ts/<rest> (batch-50).
const subpathAlias = [
  {
    find: /^@autolight\/([^/]+)\/(.+)$/,
    replacement: join(packages, "$1", "src", "$2.ts"),
  },
];

export default defineConfig({
  resolve: { alias: [...subpathAlias, ...Object.entries(workspaceAlias).map(([find, replacement]) => ({ find, replacement }))] },
  test: {
    // Extend the defaults instead of replacing them: a bare `exclude` drops
    // **/node_modules/** and the config-file patterns (batch-50).
    exclude: [...configDefaults.exclude, "**/dist/**"],
    include: ["src/**/*.test.ts"],
  },
});

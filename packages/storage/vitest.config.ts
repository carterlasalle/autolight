import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

// Same resolution as apps/desktop/vitest.config.ts: workspace packages resolve
// to their sources, so this package's tests exercise the code the app bundles
// instead of a package dist that may predate a sibling's current edits.
const workspaceSrc = join(root, "..");

function workspaceNames(): string[] {
  try {
    return readdirSync(workspaceSrc, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // One labeled error instead of a config-load stack: the fix is always the
    // checkout layout.
    throw new Error(`vitest config cannot list ${workspaceSrc}; run from the monorepo checkout`);
  }
}

const workspaceAlias = Object.fromEntries(
  workspaceNames().map((name) => [`@autolight/${name}`, join(workspaceSrc, name, "src", "index.ts")]),
);

// Browser-safe subpaths: the greedy capture resolves @autolight/pkg/a/b too.
const subpathAlias = [
  {
    find: /^@autolight\/([^/]+)\/(.+)$/,
    replacement: join(workspaceSrc, "$1", "src", "$2.ts"),
  },
];

export default defineConfig({
  // The regex alias comes first so a deep specifier never resolves through
  // the string alias (which would append the subpath to src/index.ts).
  resolve: { alias: [...subpathAlias, ...Object.entries(workspaceAlias).map(([find, replacement]) => ({ find, replacement }))] },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});

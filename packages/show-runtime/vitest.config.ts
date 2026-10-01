import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));
// Same resolution as apps/desktop/vitest.config.ts: workspace packages resolve
// to their sources, so this package's tests exercise the code the app bundles
// instead of a package dist that may predate a sibling's current edits.
const workspaceSrc = join(root, "..");
const workspaceAlias = Object.fromEntries(
  readdirSync(workspaceSrc).map((p) => [`@autolight/${p}`, join(workspaceSrc, p, "src", "index.ts")]),
);

export default defineConfig({
  resolve: { alias: workspaceAlias },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});

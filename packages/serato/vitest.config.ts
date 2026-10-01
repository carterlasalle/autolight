import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));
const packages = join(root, "..");
// Same resolution as apps/desktop/vitest.config.ts: workspace packages resolve
// to their sources, so this package's tests exercise the code the app bundles
// instead of a package dist that may predate a sibling's current edits.
const workspaceAlias = Object.fromEntries(
  ["contracts", "rekordbox-library", "rekordbox-live", "storage"].map((name) => [
    `@autolight/${name}`,
    join(packages, name, "src", "index.ts"),
  ]),
);

export default defineConfig({
  resolve: { alias: workspaceAlias },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});

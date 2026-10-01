import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));
const workspaceSrc = join(root, "..");
const workspaceAlias = Object.fromEntries(
  readdirSync(workspaceSrc, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => [`@autolight/${e.name}`, join(workspaceSrc, e.name, "src", "index.ts")]),
);

export default defineConfig({
  resolve: { alias: workspaceAlias },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});

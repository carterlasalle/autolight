import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));
const workspaceSrc = join(root, "..");
const workspaceAlias = Object.fromEntries(
  readdirSync(workspaceSrc).map((name) => [
    `@autolight/${name}`,
    join(workspaceSrc, name, "src", "index.ts"),
  ]),
);

export default defineConfig({
  resolve: { alias: workspaceAlias },
  test: {
    exclude: ["node_modules/**", "dist/**"],
    include: ["src/**/*.test.ts"],
  },
});

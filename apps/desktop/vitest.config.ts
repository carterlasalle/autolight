import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright journeys live in e2e/; vitest collects src only, never dist (S18).
    include: ["src/**/*.test.ts"],
    exclude: ["journeys/**", "node_modules/**", "dist/**"],
  },
});

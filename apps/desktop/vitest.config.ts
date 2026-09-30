import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright journeys live here; vitest must not execute them
    // (it reports "Playwright Test did not expect test() to be called here").
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
});

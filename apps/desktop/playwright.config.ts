import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./journeys",
  testMatch: "**/*.journey.ts",
  fullyParallel: true,
  reporter: "line",
});

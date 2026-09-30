import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./journeys",
  testMatch: "**/*.journey.ts",
  // Electron E2E (T-QA-02): one app instance at a time; launches are heavy
  // and each run owns a temp userData dir plus loopback sockets.
  fullyParallel: false,
  workers: 1,
  // Launch plus the 11 M1 steps plus a 5 s renderer freeze need headroom.
  timeout: 180000,
  expect: { timeout: 30000 },
  retries: 0,
  reporter: "line",
  outputDir: "./test-results",
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});

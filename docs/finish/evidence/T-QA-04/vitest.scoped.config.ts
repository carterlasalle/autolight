import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@autolight/config": "/Users/rocket/autolight/packages/config/src/index.ts",
    },
  },
  test: {
    include: [
      "/Users/rocket/autolight/apps/desktop/electron/services/fault-injection.test.ts",
      "/Users/rocket/autolight/apps/desktop/electron/services/secrets-service.test.ts",
    ],
  },
});

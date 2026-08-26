import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Keeps the structured access/warn logs out of the test report.
    env: { LOG_LEVEL: "silent", UPSTREAM_TIMEOUT_MS: "2000" },
    include: ["tests/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
});

import { defineConfig } from "vitest/config";

// Integration tests share one Postgres database (leasing_test), so files run one at a time.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/integration/**/*.int.test.ts"],
    environment: "node",
    setupFiles: ["tests/helpers/int-setup.ts"],
    globalSetup: ["tests/helpers/int-global.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

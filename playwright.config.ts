import { defineConfig, devices } from "@playwright/test";

// The server and worker are started by scripts/e2e.sh (so the whole stack can run inside the
// egress sandbox), not by Playwright's webServer option.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "storage/e2e-results.json" }]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3042", trace: "retain-on-failure", screenshot: "only-on-failure" },
  outputDir: "storage/e2e-artifacts",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

import { defineConfig, devices } from "@playwright/test";

// E2E runs in Chromium. Locally it uses /usr/bin/chromium; in CI, Playwright's own.
// E2E_BASE_URL points the suite at a running deployment (the live Vercel URL);
// E2E_LIVE=1 also turns off the AI stubs so the real route is exercised.
// E2E_PORT picks the local port. The suite never reuses a server it did not start:
// a busy port fails the run instead of silently testing another process's build.
const port = Number(process.env.E2E_PORT ?? 3200);
const base = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
const executablePath = process.env.CHROMIUM_PATH ?? (process.env.CI ? undefined : "/usr/bin/chromium");

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e.json" }]],
  use: {
    baseURL: base,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: `pnpm start --port ${port}`, url: base, reuseExistingServer: false, timeout: 120_000 },
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

// Unit tests run in a real Chromium (Vitest browser mode), the same engine
// the app runs in. Locally this uses /usr/bin/chromium; CI uses Playwright's.
const executablePath = process.env.CHROMIUM_PATH ?? (process.env.CI ? undefined : "/usr/bin/chromium");

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts", "golden/**/*.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: executablePath ? { executablePath } : {} }),
      instances: [{ browser: "chromium" }],
    },
  },
});

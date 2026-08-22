import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3101";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "pwa-installability.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: "test-results/playwright-pwa",
  use: {
    ...devices["Pixel 5"],
    baseURL,
    launchOptions: {
      executablePath:
        process.env.KANA_E2E_CHROME_PATH || "/usr/bin/google-chrome",
    },
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "HOSTNAME=127.0.0.1 PORT=3101 node .next/standalone/server.js",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});

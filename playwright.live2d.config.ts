import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3102";

export default defineConfig({
  testDir: "./tests/live2d-e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: "test-results/playwright-live2d",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      executablePath:
        process.env.KANA_E2E_CHROME_PATH || "/usr/bin/google-chrome",
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3102",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});

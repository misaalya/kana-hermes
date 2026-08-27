import { defineConfig, devices, chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

const baseURL = "http://127.0.0.1:3100";
const systemChromePath =
  process.env.KANA_E2E_CHROME_PATH || "/usr/bin/google-chrome";
// Fall back to the Playwright-bundled Chromium so acceptance journeys also run
// on machines and CI containers without a system Google Chrome install.
const executablePath = existsSync(systemChromePath)
  ? systemChromePath
  : chromium.executablePath();

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "pwa-installability.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "line",
  outputDir: "test-results/playwright",
  use: {
    baseURL,
    launchOptions: { executablePath },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      // Keep acceptance isolated from a developer's already-running server in
      // the same checkout; Next uses one lock per dist directory.
      KANA_NEXT_DIST_DIR: ".next-e2e",
      KANA_DATA_DIR: path.join(process.cwd(), "test-results", "kana-e2e-data"),
    },
  },
  projects: [
    {
      name: "desktop-chrome",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});

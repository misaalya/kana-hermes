import { chromium, defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { withSeededPassword } from "./tests/e2e/access-password";

const baseURL = "http://127.0.0.1:3103";
const systemChromePath =
  process.env.KANA_E2E_CHROME_PATH || "/usr/bin/google-chrome";
const executablePath = existsSync(systemChromePath)
  ? systemChromePath
  : chromium.executablePath();

/**
 * README capture, run with `npm run screenshots:readme`. It drives the real UI
 * against a stand-in Hermes and writes the images the README shows into
 * `.github/readme/`. It is deliberately not part of `npm run quality`: it needs
 * the network for Live2D's official samples, and a person judges its output.
 */
export default defineConfig({
  testDir: "./tests/readme",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "test-results/readme-playwright",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath },
  },
  webServer: {
    command: withSeededPassword(
      "npm run dev -- --hostname 127.0.0.1 --port 3103",
    ),
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      // Keep the capture out of a developer's own dev server: Next uses one
      // lock per dist directory.
      KANA_NEXT_DIST_DIR: ".next-readme",
      KANA_DATA_DIR: path.join(
        process.cwd(),
        "test-results",
        `kana-readme-data-${process.pid}`,
      ),
    },
  },
});
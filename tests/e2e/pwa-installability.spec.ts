import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, devices, expect, test } from "@playwright/test";

const baseURL = "http://127.0.0.1:3101";

// Fall back to the Playwright-bundled Chromium on machines without a system
// Google Chrome install so the production PWA journey stays runnable.
const systemChromePath =
  process.env.KANA_E2E_CHROME_PATH || "/usr/bin/google-chrome";
const executablePath = existsSync(systemChromePath)
  ? systemChromePath
  : chromium.executablePath();

test("is installable on mobile and restores the local shell while offline", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "kana-pwa-profile-"));
  const pixel = devices["Pixel 5"];
  const context = await chromium.launchPersistentContext(profile, {
    executablePath,
    headless: true,
    baseURL,
    viewport: pixel.viewport,
    deviceScaleFactor: pixel.deviceScaleFactor,
    hasTouch: pixel.hasTouch,
    isMobile: pixel.isMobile,
    userAgent: pixel.userAgent,
    serviceWorkers: "allow",
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto("/");
    const composer = page.getByRole("textbox", {
      name: /^(?:Message Kana|Pesan untuk Kana)$/,
    });
    // The onboarding wizard has no offline shortcut; walk it like a real
    // first-run user instead. A previously initialized isolated data root may
    // already be on the workspace, so never wait for a wizard that is absent.
    for (let step = 0; step < 8; step += 1) {
      if (await composer.isVisible().catch(() => false)) break;
      const enter = page.getByRole("button", { name: /^(?:Enter Kana|Mulai)$/ });
      if (await enter.isVisible().catch(() => false)) {
        await enter.click();
        break;
      }
      await page
        .getByRole("button", { name: /^(?:Continue|Lanjut)$/ })
        .click();
    }
    await expect(composer).toBeVisible();

    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      if (!registration.active) throw new Error("Kana service worker is not active.");
    });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);

    const manifest = await context.request.get(`${baseURL}/manifest.webmanifest`);
    expect(manifest.ok()).toBe(true);
    const manifestBody = await manifest.json();
    expect(manifestBody.name).toContain("Kana");
    expect(manifestBody.display).toBe("standalone");
    expect(manifestBody.start_url).toBe("/");
    expect(manifestBody.scope).toBe("/");
    expect(manifestBody.icons.length).toBeGreaterThan(0);

    const cdp = await context.newCDPSession(page);
    const appManifest = await cdp.send("Page.getAppManifest");
    expect(appManifest.errors).toEqual([]);
    const installability = await cdp.send("Page.getInstallabilityErrors");
    expect(installability.installabilityErrors).toEqual([]);

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(composer).toBeVisible();
    await expect(
      page.getByRole("region", {
        name: /^(?:Kana avatar stage|Panggung avatar Kana)$/,
      }),
    ).toBeVisible();
    const layout = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      controlled: Boolean(navigator.serviceWorker.controller),
    }));
    expect(layout.document).toBeLessThanOrEqual(layout.viewport);
    expect(layout.controlled).toBe(true);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, devices, expect, test } from "@playwright/test";

const baseURL = "http://127.0.0.1:3101";

test("is installable on mobile and restores the local shell while offline", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "kana-pwa-profile-"));
  const pixel = devices["Pixel 5"];
  const context = await chromium.launchPersistentContext(profile, {
    executablePath:
      process.env.KANA_E2E_CHROME_PATH || "/usr/bin/google-chrome",
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
    await page.getByRole("button", { name: "Use offline defaults" }).click();
    await expect(page.getByRole("textbox", { name: "Message Kana" })).toBeVisible();

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
    await expect(page.getByRole("textbox", { name: "Message Kana" })).toBeVisible();
    await expect(page.locator(".avatar-figure:not(.hidden)")).toBeVisible();
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

// Visual verification helper: captures the Kana workspace at desktop and
// mobile sizes plus the dialogue log overlay. Run with:
//   node --import tsx scripts/visual-capture.mjs [name-filter ...]
// When name filters are given, only matching captures run.
import { chromium } from "@playwright/test";

const baseUrl = process.env.KANA_CAPTURE_URL ?? "http://127.0.0.1:3100";
const outDir = "/tmp/kana-shots";
import { mkdirSync } from "node:fs";
mkdirSync(outDir, { recursive: true });

const only = new Set(process.argv.slice(2));
const wanted = (name) => only.size === 0 || only.has(name);

const browser = await chromium.launch();

async function capture(name, viewport, actions) {
  if (!wanted(name)) return;
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "kana.preferences.v5",
      JSON.stringify({
        version: 5,
        onboardingCompleted: true,
        agentMode: "mock",
        voiceMode: "mock",
        avatarMode: "mock",
      }),
    );
  });
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  if (actions) await actions(page);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });
  await page.close();
}

await capture("desktop", { width: 1440, height: 900 });
await capture("desktop-bubble-zoom", { width: 1440, height: 900 }, async (page) => {
  await page.waitForTimeout(300);
});
const zoomPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await zoomPage.addInitScript(() => {
  window.localStorage.setItem(
    "kana.preferences.v5",
    JSON.stringify({
      version: 5,
      onboardingCompleted: true,
      agentMode: "mock",
      voiceMode: "mock",
      avatarMode: "mock",
    }),
  );
});
await zoomPage.goto(baseUrl, { waitUntil: "load" });
await zoomPage.waitForTimeout(2500);
if (wanted("bubble-closeup")) {
  await zoomPage.screenshot({
    path: `${outDir}/bubble-closeup.png`,
    clip: { x: 420, y: 560, width: 860, height: 330 },
  });
}
if (wanted("header-closeup")) {
  await zoomPage.screenshot({
    path: `${outDir}/header-closeup.png`,
    clip: { x: 270, y: 0, width: 1170, height: 120 },
  });
}
await zoomPage.close();
await capture("desktop-log", { width: 1440, height: 900 }, async (page) => {
  await page.getByRole("button", { name: "Open dialogue log" }).click();
  await page.waitForTimeout(600);
});
await capture("desktop-settings", { width: 1440, height: 900 }, async (page) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.waitForTimeout(800);
});
await capture("desktop-slash", { width: 1440, height: 900 }, async (page) => {
  await page.getByRole("textbox").fill("/");
  await page.waitForTimeout(900);
});
await capture("mobile-drawer", { width: 390, height: 844 }, async (page) => {
  await page.getByRole("button", { name: /menu|conversation/i }).first().click();
  await page.waitForTimeout(600);
});
await capture("mobile", { width: 390, height: 844 });
const mobZoomWanted = wanted("mobile-composer-zoom");
const mobZoom = mobZoomWanted
  ? await browser.newPage({ viewport: { width: 390, height: 844 } })
  : null;
if (mobZoom) {
  await mobZoom.addInitScript(() => {
    window.localStorage.setItem(
      "kana.preferences.v5",
      JSON.stringify({
        version: 5,
        onboardingCompleted: true,
        agentMode: "mock",
        voiceMode: "mock",
        avatarMode: "mock",
      }),
    );
  });
  await mobZoom.goto(baseUrl, { waitUntil: "load" });
  await mobZoom.waitForTimeout(2500);
  await mobZoom.screenshot({
    path: `${outDir}/mobile-composer-zoom.png`,
    clip: { x: 0, y: 744, width: 390, height: 100 },
  });
  await mobZoom.close();
}

await browser.close();
console.log("saved to", outDir);

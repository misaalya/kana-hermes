import { test } from "@playwright/test";
import { rmSync } from "node:fs";
import path from "node:path";
import {
  README_DIR,
  composePhonePair,
  desktopContextOptions,
  expectWorkspaceReady,
  hideAvatarFromSettings,
  openSlashMenu,
  openWorkspace,
  phoneContextOptions,
  sendReadmeConversation,
} from "./workspace-capture";

/**
 * The images the README shows, captured from the real UI. Run it with
 * `npm run screenshots:readme`; it is not part of `npm run quality`. A person
 * judges the result, so every capture is preceded by an assertion that the
 * frame holds what it is meant to show.
 */

test.setTimeout(300_000);

const JPEG = { type: "jpeg" as const, quality: 82 };

test("desktop: the workspace and focus mode", async ({ page }) => {
  await openWorkspace(page);
  await sendReadmeConversation(page);
  await expectWorkspaceReady(page, { avatarVisible: true });
  await page.screenshot({
    path: path.join(README_DIR, "workspace-v6.jpg"),
    ...JPEG,
  });

  // Focus mode: the avatar goes, the room stays, and the conversation takes the
  // whole workspace.
  await hideAvatarFromSettings(page);
  await expectWorkspaceReady(page, { avatarVisible: false });
  await page.screenshot({
    path: path.join(README_DIR, "focus-mode-v2.jpg"),
    ...JPEG,
  });
});

test("desktop: the dark theme", async ({ browser, baseURL }) => {
  const context = await browser.newContext(desktopContextOptions(baseURL));
  const page = await context.newPage();
  await openWorkspace(page, { theme: "dark" });
  await sendReadmeConversation(page);
  await expectWorkspaceReady(page, { avatarVisible: true });
  await page.screenshot({
    path: path.join(README_DIR, "workspace-dark-v5.jpg"),
    ...JPEG,
  });
  await context.close();
});

test("desktop: the slash menu", async ({ page }) => {
  await openWorkspace(page);
  await sendReadmeConversation(page);
  await expectWorkspaceReady(page, { avatarVisible: true });
  await openSlashMenu(page);
  await page.screenshot({
    path: path.join(README_DIR, "slash-commands-v5.jpg"),
    ...JPEG,
  });
});

test("phones: the chat-first layout, light and dark", async ({ browser, baseURL }) => {
  const shots: string[] = [];
  for (const theme of ["light", "dark"] as const) {
    const context = await browser.newContext(phoneContextOptions(baseURL));
    const page = await context.newPage();
    await openWorkspace(page, { theme });
    await sendReadmeConversation(page);
    await expectWorkspaceReady(page, { avatarVisible: true });
    const file = path.join(README_DIR, `mobile-${theme}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
    await context.close();
  }
  await composePhonePair(
    browser,
    shots,
    path.join(README_DIR, "mobile-v6.jpg"),
  );
  for (const file of shots) rmSync(file, { force: true });
});
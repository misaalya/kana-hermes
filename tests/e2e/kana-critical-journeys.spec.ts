import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("kana.e2e.skip-seed") === "1") return;
    localStorage.setItem(
      "kana.preferences.v3",
      JSON.stringify({
        subtitleLanguage: "en",
        agentMode: "mock",
        voiceEnabled: false,
        voiceMode: "mock",
        avatarMode: "mock",
        hermes: {
          websocketUrl: "ws://127.0.0.1:9119/api/ws",
          cwd: "",
        },
      }),
    );
    sessionStorage.setItem(
      "kana.hermes.credentials.v1",
      "e2e-token-that-must-never-appear",
    );
  });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Message Kana" })).toBeVisible();
});

test("preserves displayed subtitles after the preference changes and reloads", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("Hello Kana");
  await composer.press("Enter");
  const history = page.getByLabel("Dialogue history");
  await expect(
    history.getByText("I’m here. What shall we work on?", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  await page
    .getByLabel("Language for future replies")
    .selectOption("id");
  await page.getByRole("button", { name: "Save preferences" }).click();

  await composer.fill("Halo Kana");
  await composer.press("Enter");
  await expect(
    history.getByText("Aku di sini. Kita mau mengerjakan apa?", { exact: true }),
  ).toBeVisible();
  await expect(
    history.getByText("I’m here. What shall we work on?", { exact: true }),
  ).toBeVisible();

  await page.reload();
  await expect(
    history.getByText("I’m here. What shall we work on?", { exact: true }),
  ).toBeVisible();
  await expect(
    history.getByText("Aku di sini. Kita mau mengerjakan apa?", { exact: true }),
  ).toBeVisible();
});

test("supports keyboard slash commands and exposes redacted diagnostics", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("/stat");
  await expect(page.getByRole("option", { name: /\/status/ })).toBeVisible();
  await composer.press("Tab");
  await composer.press("Enter");
  await expect(
    page.getByLabel("Dialogue history").getByText(/Mock Hermes status/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByText("Preview safe diagnostics").click();
  const preview = page.locator(".diagnostics-preview pre");
  await expect(preview).toContainText('"appVersion"');
  await expect(preview).not.toContainText("e2e-token-that-must-never-appear");
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("button", { name: "Open settings" })).toBeFocused();

  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);
});

test("guides a new browser profile into safe offline mode", async ({ page }) => {
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("kana.e2e.skip-seed", "1");
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("kana.local");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Welcome to Kana" })).toBeVisible();
  await page.getByRole("button", { name: "Use offline defaults" }).click();
  await expect(page.getByRole("textbox", { name: "Message Kana" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Connect mock agent/i })).toBeVisible();
});

test("falls back to the CSS avatar when Live2D is unavailable", async ({ page }) => {
  await page.route("https://cubism.live2d.com/**", (route) => route.abort());
  await page.evaluate(() => {
    const raw = localStorage.getItem("kana.preferences.v5");
    if (!raw) throw new Error("Expected migrated Kana preferences.");
    const preferences = JSON.parse(raw);
    preferences.avatarMode = "live2d";
    preferences.live2d.modelId = undefined;
    preferences.live2d.modelName = "Unavailable test model";
    preferences.live2d.modelUrl =
      "http://127.0.0.1:9/Unavailable.model3.json";
    localStorage.setItem("kana.preferences.v5", JSON.stringify(preferences));
  });

  await page.reload();
  await expect(page.locator(".error-banner")).toContainText(/Live2D|avatar/i);
  await expect(page.locator(".live2d-avatar-canvas.visible")).toHaveCount(0);
  await expect(page.locator(".avatar-figure:not(.hidden)")).toBeVisible();
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByText("Preview safe diagnostics").click();
  const diagnostics = page.locator(".diagnostics-preview pre");
  await expect(diagnostics).toContainText('"mode": "live2d"');
  await expect(diagnostics).toContainText('"renderMode": "mock"');
});

test("migrates legacy local history without changing its displayed subtitle", async ({
  page,
}) => {
  await page.evaluate(() => {
    localStorage.setItem(
      "kana.conversations.v1",
      JSON.stringify({
        version: 1,
        conversations: [
          {
            id: "legacy-conversation",
            title: "Legacy subtitle",
            subtitleLanguageAtCreation: "id",
            createdAt: 10,
            updatedAt: 20,
            messages: [
              {
                id: "legacy-message",
                role: "assistant",
                speech_ja: "こんにちは、ノブ！",
                subtitle: { text: "Halo Nobu!", language: "id" },
                timestamp: 15,
              },
            ],
          },
        ],
      }),
    );
  });
  await page.reload();
  const openHistory = page.getByRole("button", { name: "Open conversation history" });
  if ((page.viewportSize()?.width ?? 1_000) <= 900) {
    await expect(openHistory).toBeVisible();
    await openHistory.click();
  }
  await page.getByRole("button", { name: /Legacy subtitle/ }).click();
  await expect(
    page.getByLabel("Dialogue history").getByText("Halo Nobu!", { exact: true }),
  ).toBeVisible();
  await page.reload();
  const reopenHistory = page.getByRole("button", { name: "Open conversation history" });
  if ((page.viewportSize()?.width ?? 1_000) <= 900) {
    await expect(reopenHistory).toBeVisible();
    await reopenHistory.click();
  }
  await page.getByRole("button", { name: /Legacy subtitle/ }).click();
  await expect(
    page.getByLabel("Dialogue history").getByText("Halo Nobu!", { exact: true }),
  ).toBeVisible();
});

test("keeps a separate draft per conversation and searches stored history", async ({
  page,
}) => {
  const openHistoryIfNeeded = async () => {
    const openHistory = page.getByRole("button", { name: "Open conversation history" });
    if (await openHistory.isVisible()) await openHistory.click();
  };
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("draft for the first conversation");
  await openHistoryIfNeeded();
  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(composer).toHaveValue("");
  await composer.fill("draft for the second conversation");

  await openHistoryIfNeeded();
  await page.getByRole("button", { name: /^First meeting/ }).click();
  await expect(composer).toHaveValue("draft for the first conversation");

  await openHistoryIfNeeded();
  const search = page.getByRole("searchbox", { name: "Search conversations" });
  await search.fill("First meeting");
  await expect(page.getByRole("button", { name: /^First meeting/ })).toBeVisible();
  await expect(page.getByText("1 found")).toBeVisible();
  await search.fill("does not exist");
  await expect(page.getByText("No matching conversations.")).toBeVisible();
});

test("persists voice delivery and round-trips a credential-free backup", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Qwen3-TTS" }).click();
  await page.getByLabel("Speech delivery").selectOption("sentence_chunks");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByLabel("Speech delivery")).toHaveValue(
    "sentence_chunks",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const content = await import("node:fs/promises").then((fs) =>
    fs.readFile(path!, "utf8"),
  );
  expect(content).toContain('"kind": "kana.local-backup"');
  expect(content).not.toContain("e2e-token-that-must-never-appear");

  const restored = JSON.parse(content);
  restored.conversations = [
    {
      id: "restored-e2e-conversation",
      title: "Restored proof",
      subtitleLanguageAtCreation: "id",
      createdAt: 100,
      updatedAt: 200,
      messages: [
        {
          id: "restored-e2e-message",
          role: "assistant",
          speech_ja: "復元できました。",
          subtitle: {
            text: "Riwayat ini dipulihkan tanpa diterjemahkan ulang.",
            language: "id",
          },
          emotion: "happy",
          timestamp: 150,
        },
      ],
    },
  ];
  page.once("dialog", (dialog) => dialog.accept());
  const restoreInput = page
    .locator("label.backup-file-button")
    .filter({ hasText: "Restore backup" })
    .locator("input");
  await restoreInput.setInputFiles({
    name: "kana-restore-e2e.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(restored)),
  });
  await expect(
    page.getByText(/Restored 1 conversation.*2 now stored locally/i),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  const openHistory = page.getByRole("button", {
    name: "Open conversation history",
  });
  if (await openHistory.isVisible()) await openHistory.click();
  await page.getByRole("button", { name: /Restored proof/ }).click();
  await expect(
    page
      .getByLabel("Dialogue history")
      .getByText("Riwayat ini dipulihkan tanpa diterjemahkan ulang."),
  ).toBeVisible();
});

test("serves security headers and remains usable at target widths", async ({ page }) => {
  const response = await page.goto("/");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("script-src *");

  for (const width of [320, 360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    const layout = await page.evaluate(() => {
      const composer = document.querySelector(".composer")?.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        composerBottom: composer?.bottom ?? 0,
        viewportHeight: window.innerHeight,
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.composerBottom).toBeLessThanOrEqual(layout.viewportHeight);
  }

  await page.setViewportSize({ width: 844, height: 390 });
  const landscape = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    composerBottom:
      document.querySelector(".composer")?.getBoundingClientRect().bottom ?? 0,
    viewportHeight: innerHeight,
  }));
  expect(landscape.documentWidth).toBeLessThanOrEqual(landscape.viewportWidth);
  expect(landscape.composerBottom).toBeLessThanOrEqual(landscape.viewportHeight);

  const undersizedTargets = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]"))
      .filter((element) => element.offsetParent !== null)
      .map((element) => ({
        label: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName,
        rect: element.getBoundingClientRect(),
      }))
      .filter(({ rect }) => rect.width < 24 || rect.height < 24)
      .map(({ label, rect }) => ({ label, width: rect.width, height: rect.height })),
  );
  expect(undersizedTargets).toEqual([]);
});

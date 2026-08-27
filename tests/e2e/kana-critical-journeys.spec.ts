import { expect, test, type Page } from "@playwright/test";

/**
 * Deterministic in-browser stand-in for `hermes serve /api/ws`. It answers the
 * JSON-RPC surface Kana relies on so the critical journeys exercise real UI
 * wiring without an external Hermes installation.
 */
async function installFakeHermes(page: Page): Promise<void> {
  // The client appends the session token as a query string.
  await page.routeWebSocket(/\/api\/ws(\?|$)/, (ws) => {
    const sessionId = "e2e-hermes-session";
    const send = (frame: unknown) => ws.send(JSON.stringify(frame));
    const reply = (id: unknown, result: unknown) =>
      send({ jsonrpc: "2.0", id, result });

    send({
      jsonrpc: "2.0",
      method: "event",
      params: { type: "gateway.ready" },
    });

    ws.onMessage((raw) => {
      let frame: {
        id?: number | string | null;
        method?: string;
        params?: { text?: string };
      };
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return;
      }
      const id = frame.id ?? null;

      switch (frame.method) {
        case "session.create":
        case "session.resume":
          reply(id, { session_id: sessionId, status: "complete" });
          return;
        case "commands.catalog":
          reply(id, {
            categories: [
              {
                name: "Session",
                pairs: [
                  ["status", "Show the current Hermes session status"],
                  ["new", "Start a new conversation"],
                ],
              },
            ],
          });
          return;
        case "complete.slash":
          reply(id, { items: [{ text: "/status" }] });
          return;
        case "session.status":
          reply(id, { output: "fake hermes session status ok" });
          return;
        case "slash.exec":
        case "command.dispatch":
          reply(id, { output: "fake command output" });
          return;
        case "prompt.submit": {
          reply(id, {});
          const submitted = frame.params?.text ?? "";
          const language =
            /"subtitle_language"\s*:\s*"([a-z]+)"/i.exec(submitted)?.[1] ??
            "en";
          const subtitles: Record<string, string> = {
            en: "Hello! I am here.",
            id: "Halo! Aku di sini.",
            ja: "こんにちは、ここにいます。",
          };
          setTimeout(() => {
            send({
              jsonrpc: "2.0",
              method: "event",
              params: {
                type: "message.complete",
                session_id: sessionId,
                payload: {
                  status: "complete",
                  text: JSON.stringify({
                    speech_ja: "こんにちは、ここにいます。",
                    subtitle: {
                      text: subtitles[language] ?? subtitles.en,
                      language,
                    },
                    emotion: "neutral",
                  }),
                },
              },
            });
          }, 30);
          return;
        }
        default:
          if (id !== null) reply(id, {});
      }
    });
  });
}

test.beforeEach(async ({ page }) => {
  // Keep journeys deterministic: never load remote Live2D assets here.
  await page.route(/cubism\.live2d\.com|model\.res\.live2d\.com/, (route) =>
    route.abort(),
  );
  // The dev server may sit behind the local access-password gate.
  await page.request.post("/api/auth/login", {
    data: { password: process.env.KANA_E2E_PASSWORD ?? "test" },
  });
  // Most journeys exercise the established workspace. Keep the install-level
  // wizard from racing those interactions; the dedicated onboarding journey
  // overrides the GET response below.
  await page.request.put("/api/kana/setup");
  await page.addInitScript(() => {
    if (localStorage.getItem("kana.e2e.skip-seed") === "1") return;
    localStorage.setItem(
      "kana.preferences.v3",
      JSON.stringify({
        uiLocale: "en",
        subtitleLanguage: "en",
        agentMode: "hermes",
        voiceEnabled: false,
        voiceMode: "qwen3",
        avatarMode: "live2d",
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
  await installFakeHermes(page);
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Message Kana" })).toBeVisible();
});

async function openHistory(page: Page): Promise<void> {
  const openHistory = page.getByRole("button", {
    name: "Open conversation history",
  });
  await openHistory.click();
}

test("preserves displayed subtitles after the preference changes and reloads", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("Hello Kana");
  await composer.press("Enter");

  const overlay = page.getByText("Hello! I am here.", { exact: true });
  await expect(overlay.first()).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Bahasa Indonesia", exact: true }).click();
  await page.getByRole("button", { name: "Close settings" }).click();

  await composer.fill("Halo Kana");
  await composer.press("Enter");
  await expect(
    page.getByText("Halo! Aku di sini.", { exact: true }).first(),
  ).toBeVisible();

  await openHistory(page);
  await expect(
    page.getByText("Hello! I am here.", { exact: true }).first(),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message Kana" })).toBeVisible();
  await openHistory(page);
  await expect(
    page.getByText("Hello! I am here.", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Halo! Aku di sini.", { exact: true }).first(),
  ).toBeVisible();
});

test("persists the selected stage background across refreshes", async ({ page }) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", {
    name: /^Avatar(?: Avatar and stage)?$/,
  }).click();
  await page.getByRole("radio", {
    name: "Star parade. Playful stars with calm spacing",
    exact: true,
  }).click();
  await page.getByRole("button", { name: "Close settings" }).click();

  await expect(page.locator(".kana-stage-pattern")).toHaveAttribute(
    "data-background",
    "pattern-stars",
  );

  await page.reload();
  await expect(page.locator(".kana-stage-pattern")).toHaveAttribute(
    "data-background",
    "pattern-stars",
  );
});

test("updates workspace, history, chat, and settings copy with the interface language", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page
    .getByRole("heading", { name: "Interface language" })
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Bahasa Indonesia", exact: true })
    .click();

  await expect(page.getByRole("heading", { name: "Pengaturan" }).first()).toBeVisible();
  await expect(page.getByText("Preferensi pribadi", { exact: true })).toBeVisible();
  await expect(page.getByText("Bahasa antarmuka", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tutup pengaturan" }).click();

  await expect(page.getByRole("textbox", { name: "Pesan untuk Kana" })).toHaveAttribute(
    "placeholder",
    "Katakan sesuatu kepada Kana…",
  );
  await page.getByRole("button", { name: "Buka riwayat percakapan" }).click();
  await expect(page.getByRole("heading", { name: "Percakapan" })).toBeVisible();
  await expect(page.getByPlaceholder("Cari percakapan")).toBeVisible();
});

test("shows complete background cards and keeps an uploaded image locally", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", {
    name: /^Avatar(?: Avatar and stage)?$/,
  }).click();

  const expectedVisibleCards = (page.viewportSize()?.width ?? 0) < 640 ? 1 : 3;
  const layout = await page.locator(".kana-background-carousel").evaluate(
    (carousel, visibleCards) => {
      const viewport = carousel.getBoundingClientRect();
      const cards = [...carousel.children]
        .slice(0, visibleCards + 1)
        .map((card) => {
          const bounds = card.getBoundingClientRect();
          return {
            fullyVisible:
              bounds.left >= viewport.left - 0.5
              && bounds.right <= viewport.right + 0.5,
            width: bounds.width,
          };
        });
      return { cards, viewportWidth: viewport.width };
    },
    expectedVisibleCards,
  );
  expect(layout.cards.slice(0, expectedVisibleCards).every((card) => card.fullyVisible)).toBe(true);
  expect(layout.cards[expectedVisibleCards]?.fullyVisible).toBe(false);
  expect(layout.cards[0]?.width).toBeCloseTo(
    (layout.viewportWidth - (expectedVisibleCards - 1) * 12) / expectedVisibleCards,
    0,
  );

  await page.locator('input[type="file"][accept*=".png"]').setInputFiles({
    name: "my-stage.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByText("my-stage is now your stage background.")).toBeVisible();
  await expect(page.getByRole("radio", { name: "my-stage. Your local background" })).toBeChecked();
  await expect(page.locator(".kana-stage-pattern")).toHaveAttribute(
    "data-background",
    "custom",
  );
  await expect(page.locator(".kana-stage-backdrop")).toHaveCSS(
    "background-image",
    /blob:/,
  );

  await page.reload();
  await expect(page.locator(".kana-stage-pattern")).toHaveAttribute(
    "data-background",
    "custom",
  );
  await expect(page.locator(".kana-stage-backdrop")).toHaveCSS(
    "background-image",
    /blob:/,
  );
});

test("recenters the avatar over a full background without restyling chat", async ({ page }) => {
  const stage = page.locator(".kana-stage-backdrop");
  const avatarViewport = page.locator(".kana-avatar-viewport");
  const avatarContent = page.locator(".kana-avatar-content");
  const avatarCanvas = page.getByTestId("live2d-canvas");
  const chatPanel = page.locator("#kana-chat-panel");
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const mobileChat = viewportWidth < 640;
  const contentWidthBefore = Math.round(
    (await avatarContent.boundingBox())?.width ?? 0,
  );
  const canvasSizeBefore = await avatarCanvas.evaluate((canvas) => ({
    height: (canvas as HTMLCanvasElement).height,
    width: (canvas as HTMLCanvasElement).width,
  }));
  const chatStyle = await chatPanel.evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return {
      background: style.backgroundColor,
      border: style.border,
      borderRadius: style.borderRadius,
      height: bounds.height,
      width: bounds.width,
    };
  });

  await expect
    .poll(async () => Math.round((await stage.boundingBox())?.width ?? 0))
    .toBe(viewportWidth);

  if (mobileChat) {
    await expect(page.getByRole("button", { name: "Hide chat" })).toBeHidden();
    await expect(chatPanel).toHaveAttribute("aria-hidden", "false");
    await expect(avatarViewport).toHaveAttribute("data-chat-open", "true");
    const mobileLayout = await page.locator(".kana-chat-dock").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const feedStyle = getComputedStyle(
        element.querySelector(".kana-chat-scroll") as HTMLElement,
      );
      return {
        dockTop: bounds.top,
        fade: feedStyle.maskImage || feedStyle.webkitMaskImage,
      };
    });
    expect(mobileLayout.dockTop).toBeGreaterThan(viewportHeight * 0.45);
    expect(mobileLayout.fade).not.toBe("none");
    return;
  }

  await page.getByRole("button", { name: "Hide chat" }).click();
  await expect(avatarViewport).toHaveAttribute("data-chat-open", "false");
  await expect
    .poll(async () => Math.round((await avatarContent.boundingBox())?.width ?? 0))
    .toBe(contentWidthBefore);
  await expect
    .poll(() =>
      avatarCanvas.evaluate((canvas) => ({
        height: (canvas as HTMLCanvasElement).height,
        width: (canvas as HTMLCanvasElement).width,
      })),
    )
    .toEqual(canvasSizeBefore);
  await expect
    .poll(() =>
      avatarContent.evaluate((element) => getComputedStyle(element).transform),
    )
    .toBe("none");
  await expect
    .poll(async () => {
      const bounds = await chatPanel.boundingBox();
      return Math.round(viewportWidth - (bounds?.x ?? 0));
    })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const bounds = await chatPanel.boundingBox();
      return Math.round(viewportWidth - (bounds?.x ?? 0));
    })
    .toBeLessThanOrEqual(20);

  await page.getByRole("button", { name: "Show chat" }).click();
  await expect(chatPanel).toHaveAttribute("aria-hidden", "false");
  await expect
    .poll(() =>
      chatPanel.evaluate((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return {
          background: style.backgroundColor,
          border: style.border,
          borderRadius: style.borderRadius,
          height: bounds.height,
          width: bounds.width,
        };
      }),
    )
    .toEqual(chatStyle);
});

test("supports keyboard slash commands end to end", async ({ page }) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.click();
  await composer.fill("/stat");
  await page
    .getByRole("option", { name: /\/status/ })
    .first()
    .waitFor();
  await expect(composer).toBeFocused();
  await composer.press("Tab");
  await expect(composer).toHaveValue("/status ");
  await composer.press("Enter");
  await openHistory(page);
  await expect(
    page.getByText("fake hermes session status ok").first(),
  ).toBeVisible();

  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);
});

test("guides a new browser profile through onboarding onto the workspace", async ({
  page,
}) => {
  await page.route("**/api/kana/setup", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ onboardingCompleted: false, completedAt: null }),
      });
      return;
    }
    await route.continue();
  });
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

  await expect(
    page.getByRole("heading", { name: "Welcome to Kana" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByRole("heading", { name: "Choose the agent connection" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByRole("heading", { name: "Choose how Kana is presented" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByRole("heading", { name: "Kana is ready" }),
  ).toBeVisible();
  await expect(page.getByText("hermes", { exact: true })).toBeVisible();
  await expect(page.getByText("qwen3", { exact: true })).toBeVisible();
  await expect(page.getByText("live2d", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Enter Kana" }).click();

  await expect(
    page.getByRole("textbox", { name: "Message Kana" }),
  ).toBeVisible();
});

test("falls back to the placeholder avatar when Live2D cannot load", async ({
  page,
}) => {
  await page.evaluate(() => {
    const raw = localStorage.getItem("kana.preferences.v5");
    if (!raw) throw new Error("Expected migrated Kana preferences.");
    const preferences = JSON.parse(raw);
    preferences.live2d.modelId = undefined;
    preferences.live2d.modelName = "Unavailable test model";
    preferences.live2d.modelUrl =
      "http://127.0.0.1:9/Unavailable.model3.json";
    localStorage.setItem("kana.preferences.v5", JSON.stringify(preferences));
  });

  await page.reload();
  await expect(
    page.getByText("Waiting for Live2D avatar"),
  ).toBeVisible();
  await expect(page.getByTestId("live2d-canvas")).toHaveClass(/opacity-0/);
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
  await openHistory(page);
  await page.getByRole("button", { name: /Legacy subtitle/ }).click();
  await expect(
    page.getByText("Halo Nobu!", { exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await openHistory(page);
  await page.getByRole("button", { name: /Legacy subtitle/ }).click();
  await expect(
    page.getByText("Halo Nobu!", { exact: true }).first(),
  ).toBeVisible();
});

test("keeps a separate draft per conversation and searches stored history", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("draft for the first conversation");

  await openHistory(page);
  await page.getByRole("button", { name: /New conversation/ }).click();
  await expect(composer).toHaveValue("");
  await composer.fill("draft for the second conversation");

  await openHistory(page);
  await page.getByRole("button", { name: /^First meeting/ }).click();
  await expect(composer).toHaveValue("draft for the first conversation");

  await openHistory(page);
  const search = page.getByRole("searchbox", { name: "Search conversations" });
  await search.fill("First meeting");
  await expect(
    page.getByRole("button", { name: /^First meeting/ }),
  ).toBeVisible();
  await expect(page.getByText("1 found")).toBeVisible();
  await search.fill("does not exist");
  await expect(page.getByText("No matching conversations.")).toBeVisible();
});

test("serves security headers and keeps the composer reachable at target widths", async ({
  page,
}) => {
  const response = await page.goto("/");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("script-src *");

  for (const width of [320, 360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    const layout = await page.evaluate(() => {
      const composer = document
        .querySelector("#kana-message")
        ?.getBoundingClientRect();
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
      document.querySelector("#kana-message")?.getBoundingClientRect().bottom ??
      0,
    viewportHeight: innerHeight,
  }));
  expect(landscape.documentWidth).toBeLessThanOrEqual(landscape.viewportWidth);
  expect(landscape.composerBottom).toBeLessThanOrEqual(landscape.viewportHeight);
});

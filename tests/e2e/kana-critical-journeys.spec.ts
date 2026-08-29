import { expect, test, type Page } from "@playwright/test";

/** Deterministic stand-in for Kana's current HTTP-RPC + SSE Hermes relay. */
async function installFakeHermes(page: Page): Promise<void> {
  type FakeSession = {
    runtimeId: string;
    persistentId: string;
    title: string;
    startedAt: number;
    lastActive: number;
    history: Array<{ role: "user" | "assistant"; text: string }>;
  };
  const sessions = new Map<string, FakeSession>();
  const runtimeToPersistent = new Map<string, string>();
  let nextSession = 1;
  let activeRuntimeId = "e2e-hermes-runtime-0";
  let activeProvider = "fireworks_ai";
  let activeModel = "accounts/fireworks/models/deepseek-v4-flash-0731";
  const firstSession: FakeSession = {
    runtimeId: activeRuntimeId,
    persistentId: "e2e-hermes-stored-0",
    title: "First meeting",
    startedAt: 1,
    lastActive: 2,
    history: [{ role: "user", text: "Existing test conversation" }],
  };
  sessions.set(firstSession.persistentId, firstSession);
  runtimeToPersistent.set(firstSession.runtimeId, firstSession.persistentId);

  await page.addInitScript(() => {
    type E2EWindow = Window & {
      __kanaE2eEventSources?: EventTarget[];
      __kanaE2eEmit?: (event: string, data: unknown) => void;
    };
    const target = window as E2EWindow;
    target.__kanaE2eEventSources = [];

    class FakeEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = true;
      readyState = FakeEventSource.CONNECTING;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        target.__kanaE2eEventSources?.push(this);
        queueMicrotask(() => {
          this.readyState = FakeEventSource.OPEN;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("gateway", {
              data: JSON.stringify({ connected: true }),
            }),
          );
        });
      }

      close(): void {
        this.readyState = FakeEventSource.CLOSED;
      }
    }

    target.__kanaE2eEmit = (event, data) => {
      for (const source of target.__kanaE2eEventSources ?? []) {
        source.dispatchEvent(
          new MessageEvent(event, { data: JSON.stringify(data) }),
        );
      }
    };
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: FakeEventSource,
    });
  });

  const emitHermesEvent = async (
    type: string,
    payload: Record<string, unknown>,
    runtimeId: string,
  ) => {
    await page.evaluate(
      ({ eventType, eventPayload, runtimeId }) => {
        const target = window as Window & {
          __kanaE2eEmit?: (event: string, data: unknown) => void;
        };
        target.__kanaE2eEmit?.("hermes", {
          jsonrpc: "2.0",
          method: "event",
          params: {
            type: eventType,
            session_id: runtimeId,
            payload: eventPayload,
          },
        });
      },
      { eventType: type, eventPayload: payload, runtimeId },
    );
  };

  await page.route("**/api/kana/sessions", (route) => {
    const directory = [...sessions.values()]
      .sort((a, b) => b.lastActive - a.lastActive)
      .map((session) => ({
        hermesSessionKey: session.persistentId,
        title: session.title,
        preview: session.history.at(-1)?.text ?? "",
        messageCount: session.history.length,
        startedAt: session.startedAt,
        lastActive: session.lastActive,
      }));
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ sessions: directory }),
    });
  });
  await page.route("**/api/local-runtime/hermes**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        controlAvailable: true,
        state: "running",
        managed: false,
        executable: "/usr/bin/hermes",
        port: 9119,
        websocketUrl: "ws://127.0.0.1:9119/api/ws",
        message: "Hermes test relay is ready.",
      }),
    }),
  );
  await page.route("**/api/voice/tts/status**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ state: "stopped", message: "Voice is optional." }),
    }),
  );
  await page.route("**/api/hermes/rpc", async (route) => {
    const body = route.request().postDataJSON() as {
      method?: string;
      params?: Record<string, unknown>;
    };
    let result: unknown = {};
    let completedResponse: string | null = null;
    let completedRuntimeId = activeRuntimeId;

    switch (body.method) {
      case "session.create": {
        const index = nextSession++;
        const session: FakeSession = {
          runtimeId: `e2e-hermes-runtime-${index}`,
          persistentId: `e2e-hermes-stored-${index}`,
          title: String(body.params?.title ?? "New conversation"),
          startedAt: index + 2,
          lastActive: index + 2,
          history: [],
        };
        sessions.set(session.persistentId, session);
        runtimeToPersistent.set(session.runtimeId, session.persistentId);
        activeRuntimeId = session.runtimeId;
        result = {
          session_id: session.runtimeId,
          stored_session_id: session.persistentId,
        };
        break;
      }
      case "session.resume": {
        const persistentId = String(body.params?.session_id ?? "");
        const session = sessions.get(persistentId) ?? firstSession;
        activeRuntimeId = session.runtimeId;
        result = {
          session_id: session.runtimeId,
          session_key: session.persistentId,
          resumed: session.persistentId,
          running: false,
          messages: session.history,
        };
        break;
      }
      case "session.title": {
        const runtimeId = String(body.params?.session_id ?? activeRuntimeId);
        const persistentId = runtimeToPersistent.get(runtimeId);
        result = {
          title: persistentId
            ? sessions.get(persistentId)?.title ?? "Untitled"
            : "Untitled",
        };
        break;
      }
      case "commands.catalog":
        result = {
          categories: [
            {
              name: "Session",
              pairs: [
                ["/status", "Show the current Hermes session status"],
                ["/new", "Start a new conversation"],
              ],
            },
          ],
        };
        break;
      case "complete.slash":
        result = {
          replace_from: 0,
          items: [{ text: "/status", display: "/status" }],
        };
        break;
      case "session.status":
        result = { output: "fake hermes session status ok" };
        break;
      case "model.options":
        result = {
          provider: activeProvider,
          model: activeModel,
          providers: [
            {
              slug: "fireworks_ai",
              name: "Fireworks AI",
              models: ["accounts/fireworks/models/deepseek-v4-flash-0731"],
              is_current: activeProvider === "fireworks_ai",
              authenticated: true,
            },
            {
              slug: "openrouter",
              name: "OpenRouter",
              models: ["deepseek/deepseek-v4"],
              is_current: activeProvider === "openrouter",
              authenticated: true,
            },
          ],
        };
        break;
      case "config.set": {
        const value = String(body.params?.value ?? "");
        if (body.params?.key === "model" && value.includes("--provider 'openrouter'")) {
          activeProvider = "openrouter";
          activeModel = "deepseek/deepseek-v4";
          result = { key: "model", value: activeModel, scope: "session" };
        }
        break;
      }
      case "slash.exec": {
        const command = String(body.params?.command ?? "");
        if (command.startsWith("model ") && command.includes("--provider 'openrouter'")) {
          activeProvider = "openrouter";
          activeModel = "deepseek/deepseek-v4";
          result = { output: "Model switched" };
        } else {
          result = { type: "exec", output: "fake command output" };
        }
        break;
      }
      case "command.dispatch":
        result = { type: "exec", output: "fake command output" };
        break;
      case "approval.respond":
        result = { resolved: true };
        break;
      case "prompt.submit": {
        const runtimeId = String(body.params?.session_id ?? activeRuntimeId);
        const persistentId = runtimeToPersistent.get(runtimeId);
        const session = persistentId ? sessions.get(persistentId) : undefined;
        const submitted = String(body.params?.text ?? "");
        const language =
          /"subtitle_language"\s*:\s*"([a-z]+)"/i.exec(submitted)?.[1] ?? "en";
        const subtitles: Record<string, string> = {
          en: "Hello! I am here.",
          id: "Halo! Aku di sini.",
          ja: "こんにちは、ここにいます。",
        };
        completedResponse = JSON.stringify({
          speech_ja: "こんにちは、ここにいます。",
          subtitle: {
            text: subtitles[language] ?? subtitles.en,
            language,
          },
          emotion: "neutral",
        });
        session?.history.push(
          { role: "user", text: submitted },
          { role: "assistant", text: completedResponse },
        );
        if (session) session.lastActive = Date.now() / 1000;
        completedRuntimeId = runtimeId;
        result = { accepted: true };
        break;
      }
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ result }),
    });
    if (completedResponse) {
      const responseText = completedResponse;
      setTimeout(() => {
        void emitHermesEvent(
          "message.complete",
          {
            status: "complete",
            text: responseText,
          },
          completedRuntimeId,
        ).catch(() => undefined);
      }, 30);
    }
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
        voiceMode: "configured",
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

test("renders text replies without entering the TTS pipeline when voice is off", async ({
  page,
}) => {
  let speechRequests = 0;
  await page.route("**/api/voice/tts/speech**", async (route) => {
    speechRequests += 1;
    await route.fulfill({ status: 503, body: "TTS must not be called." });
  });

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: /^Voice/ }).click();
  const voiceSwitch = page.getByRole("switch", { name: "Japanese voice" });
  await expect(voiceSwitch).not.toBeChecked();
  await voiceSwitch.click();
  await expect(voiceSwitch).toBeChecked();
  await voiceSwitch.click();
  await expect(voiceSwitch).not.toBeChecked();
  await page.getByRole("button", { name: "Close settings" }).click();

  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("Voice-off latency check");
  await composer.press("Enter");

  await expect(page.getByText("Hello! I am here.", { exact: true }).first())
    .toBeVisible({ timeout: 2_000 });
  expect(speechRequests).toBe(0);
});

test("preserves displayed subtitles after the preference changes and reloads", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("Hello Kana");
  await composer.press("Enter");

  const overlay = page.getByText("Hello! I am here.", { exact: true });
  await expect(overlay.first()).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  await page
    .getByRole("heading", { name: "Subtitle language" })
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Bahasa Indonesia", exact: true })
    .click();
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

test("adjusts the active avatar from the workspace instead of settings", async ({
  page,
}) => {
  const trigger = page.getByRole("button", {
    name: "Adjust avatar position and size",
  });
  await trigger.click();

  const panel = page.getByRole("region", {
    name: "Adjust avatar position and size",
  });
  await expect(panel).toBeVisible();
  const horizontal = panel.getByRole("slider", { name: /X position/ });
  await horizontal.evaluate((input) => {
    const slider = input as HTMLInputElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    nativeSetter?.call(slider, "20");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(horizontal).toHaveValue("20");

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await page.reload();
  await trigger.click();
  await expect(
    page.getByRole("region", { name: "Adjust avatar position and size" })
      .getByRole("slider", { name: /X position/ }),
  ).toHaveValue("20");

  await trigger.click();
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: /^Avatar(?: Avatar and stage)?$/ }).click();
  await expect(page.getByRole("slider", { name: /X position/ })).toHaveCount(0);
});

test("changes the active Hermes model with an explicit provider", async ({ page }) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: /^AI model/ }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: "accounts/fireworks/models/deepseek-v4-flash-0731" })).toBeVisible();

  await page.getByLabel("Provider").selectOption("openrouter");
  await page.getByLabel("Model").selectOption("deepseek/deepseek-v4");
  await page.getByRole("button", { name: "Use this model" }).click();

  await expect(page.getByText("The model for this conversation has been changed.")).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: "deepseek/deepseek-v4" })).toBeVisible();
});

test("shows Hermes approval choices and resolves a session approval", async ({ page }) => {
  await page.evaluate(() => {
    const target = window as Window & { __kanaE2eEmit?: (event: string, data: unknown) => void };
    target.__kanaE2eEmit?.("hermes", {
      jsonrpc: "2.0",
      method: "event",
      params: {
        type: "approval.request",
        payload: {
          command: "find /home/user -name .env",
          description: "Search protected files",
          choices: ["once", "session", "deny"],
          allow_permanent: false,
        },
      },
    });
  });

  await expect(page.getByRole("heading", { name: "Hermes needs approval" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run once" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow for session" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deny" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Always allow" })).toBeHidden();
  await page.getByRole("button", { name: "Allow for session" }).click();
  await expect(page.getByRole("heading", { name: "Hermes needs approval" })).toBeHidden();
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
  await expect(composer).toHaveValue("/status");
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
    page.getByRole("heading", { name: "Kenalan dulu dengan Kana" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Lanjut" }).click();

  await expect(
    page.getByRole("heading", { name: "Buat percakapan terasa nyaman" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Lanjut" }).click();

  await expect(
    page.getByRole("heading", { name: "Pilih tampilan dan suara" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Lanjut" }).click();

  await expect(
    page.getByRole("heading", { name: "Kana siap menemanimu" }),
  ).toBeVisible();
  await expect(page.getByText("Hermes", { exact: true })).toBeVisible();
  await expect(page.getByText("Mesin suara", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mulai" }).click();

  await expect(
    page.getByRole("textbox", { name: "Pesan untuk Kana" }),
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

test("restores Hermes history instead of trusting obsolete browser transcripts", async ({
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
  await expect(page.getByRole("button", { name: /^First meeting/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Legacy subtitle/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^First meeting/ }).click();
  await expect(
    page.getByText("Existing test conversation", { exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await openHistory(page);
  await page.getByRole("button", { name: /^First meeting/ }).click();
  await expect(
    page.getByText("Existing test conversation", { exact: true }).first(),
  ).toBeVisible();
});

test("keeps a separate draft per conversation and searches stored history", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("Make the first conversation non-empty");
  await composer.press("Enter");
  await expect(page.getByText("Hello! I am here.", { exact: true }).first()).toBeVisible();
  await composer.fill("draft for the first conversation");

  await openHistory(page);
  await page.getByText("New", { exact: true }).click();
  await expect(composer).toHaveValue("");
  await composer.fill("draft for the second conversation");

  await openHistory(page);
  await page
    .getByRole("button", { name: /^Make the first conversation non-empty/ })
    .click();
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

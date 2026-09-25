import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_ACCESS_PASSWORD } from "./access-password";

/** A reply in the Markdown Hermes writes, with a URL too long to wrap at a space. */
const RESEARCH_REPLY = [
  "Here is the latest on **Kupang weather**:",
  "",
  "- **BMKG warning:** strong winds along the coast.[1]",
  "- **Flights:** short delays around NTT.[2]",
  "",
  "Source: https://www.example.com/indonesia/articles/cr86xn92eey8o/kupang-weather-warning-strong-winds-along-the-coast-and-flight-delays",
].join("\n");

type FakeHermes = {
  /** The held research turn runs its next tool; Hermes is still working. */
  advanceHeldTurn(): Promise<void>;
  /** The held research turn replies. */
  finishHeldTurn(): Promise<void>;
};

let hermes: FakeHermes;

/** `/model` arguments read like Hermes: split on whitespace, never unquoted. */
function modelSwitch(args: string): { model: string; provider: string } {
  const parts = args.trim().split(/\s+/);
  const at = parts.indexOf("--provider");
  return {
    provider: at >= 0 ? (parts[at + 1] ?? "") : "",
    model: parts.filter((part, index) => !part.startsWith("--") && (at < 0 || index !== at + 1)).join(" "),
  };
}

/**
 * Deterministic stand-in for Kana's current HTTP-RPC + SSE Hermes relay.
 * A message mentioning "research" starts a turn the test drives by hand:
 * like Hermes, it stores each tool as it finishes and reports the turn as
 * running on session.resume until it replies.
 */
async function installFakeHermes(page: Page): Promise<FakeHermes> {
  type FakeSession = {
    runtimeId: string;
    persistentId: string;
    title: string;
    startedAt: number;
    lastActive: number;
    running?: boolean;
    history: Array<{ role: "user" | "assistant" | "tool"; text?: string; name?: string; context?: string }>;
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

  let heldTurn: { session: FakeSession; runtimeId: string } | null = null;
  const runTool = async (name: string, context: string) => {
    if (!heldTurn) throw new Error("No research turn is running.");
    const { session, runtimeId } = heldTurn;
    const toolId = `${name}-${session.history.length}`;
    await emitHermesEvent("tool.start", { tool_id: toolId, name, context }, runtimeId);
    session.history.push({ role: "tool", name, context });
    await emitHermesEvent("tool.complete", { tool_id: toolId, name, summary: context, duration_s: 0.4 }, runtimeId);
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
  await page.route("**/api/voice/tts/engine", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        provider: { id: "irodori-local", type: "irodori-local", name: "Irodori TTS", configured: true, model: "Irodori-TTS v4.1 Anime", capabilities: { instruction: false, localInstall: true, upstreamCancellation: true, voiceLibrary: true } },
        install: { state: "not_installed", engineInstalled: false, modelInstalled: false, modelSource: null, step: null, phase: null, completedBytes: 0, totalBytes: 0, downloadBytes: 3_544_900_182, requiredDiskBytes: 4_331_065_517, freeDiskBytes: 50_000_000_000, partialDownloadBytes: 0, int8: true, message: "The local voice engine has not been downloaded yet." },
      }),
    }),
  );
  await page.route("**/api/hermes/rpc", async (route) => {
    const body = route.request().postDataJSON() as {
      method?: string;
      params?: Record<string, unknown>;
    };
    let result: unknown = {};
    let error: string | null = null;
    let completedResponse: string | null = null;
    let completedRuntimeId = activeRuntimeId;

    switch (body.method) {
      case "session.create": {
        const index = nextSession++;
        const session: FakeSession = {
          runtimeId: `e2e-hermes-runtime-${index}`,
          persistentId: `e2e-hermes-stored-${index}`,
          // Like Hermes: untitled until named, rather than a placeholder title.
          title: String(body.params?.title ?? ""),
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
          running: session.running === true,
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
        const target = modelSwitch(String(body.params?.value ?? ""));
        if (body.params?.key === "model" && target.provider === "openrouter") {
          activeProvider = "openrouter";
          activeModel = target.model;
          result = { key: "model", value: activeModel, scope: "session" };
        } else if (body.params?.key === "model") {
          error = `Unknown provider '${target.provider}'.`;
        }
        break;
      }
      case "slash.exec": {
        const command = String(body.params?.command ?? "");
        const target = command.startsWith("model ") ? modelSwitch(command.slice(6)) : null;
        if (target?.provider === "openrouter") {
          activeProvider = "openrouter";
          activeModel = target.model;
          result = { output: "Model switched" };
        } else if (target) {
          result = { output: `Unknown provider '${target.provider}'.` };
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
        // Stand-in for Hermes following the contract: the user's words, then
        // the Kana note asking for the header; the answer uses the language
        // the user wrote in. Kana sends no subtitle setting.
        if (/subtitle_language|kana_request/.test(submitted)) throw new Error("Kana sent the old JSON wrapper.");
        const noteStart = submitted.lastIndexOf("\n\n<kana>\n");
        if (noteStart === -1 || !/\n---\nja: /.test(submitted.slice(noteStart))) {
          throw new Error("Kana sent no response contract.");
        }
        const userMessage = submitted.slice(0, noteStart);
        const language = /\b(halo|aku|kamu|apa)\b/i.test(userMessage) ? "id" : "en";
        const subtitles: Record<string, string> = {
          en: "Hello! I am here.",
          id: "Halo! Aku di sini.",
          ja: "こんにちは、ここにいます。",
        };
        if (session && /research/i.test(userMessage)) {
          session.history.push({ role: "user", text: submitted });
          session.running = true;
          heldTurn = { session, runtimeId };
          result = { accepted: true };
          setTimeout(() => void runTool("web_search", "Kupang weather today").catch(() => undefined), 30);
          break;
        }
        // Asked for files, Hermes delivers two; Kana's server has already
        // swapped their paths for signed links by the time they arrive here.
        const delivered = /\bfiles\b/i.test(userMessage)
          ? ["", "MEDIA:/api/media/e2e-audio/tts_e2e.wav", "MEDIA:/api/media/e2e-report/Laporan%20akhir.pdf"]
          : [];
        completedResponse = [
          "---",
          "ja: こんにちは、ここにいます。",
          "emotion: neutral",
          `lang: ${language}`,
          "---",
          subtitles[language] ?? subtitles.en,
          ...delivered,
        ].join("\n");
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
      status: error ? 502 : 200,
      contentType: "application/json",
      body: JSON.stringify(error ? { error } : { result }),
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

  return {
    advanceHeldTurn: () => runTool("web_extract", "bmkg.go.id"),
    async finishHeldTurn() {
      if (!heldTurn) throw new Error("No research turn is running.");
      const { session, runtimeId } = heldTurn;
      // A protocol 2 JSON envelope: older replies must keep working.
      const text = JSON.stringify({
        speech_ja: "調べました。",
        subtitle: { text: RESEARCH_REPLY, language: "en" },
        emotion: "happy",
      });
      session.history.push({ role: "assistant", text });
      session.running = false;
      heldTurn = null;
      await emitHermesEvent("message.complete", { status: "complete", text }, runtimeId);
    },
  };
}

test.beforeEach(async ({ page }) => {
  // Keep journeys deterministic: never load remote Live2D assets here.
  await page.route(/cubism\.live2d\.com|model\.res\.live2d\.com/, (route) =>
    route.abort(),
  );
  // The dev server may sit behind the local access-password gate.
  await page.request.post("/api/auth/login", {
    data: { password: E2E_ACCESS_PASSWORD },
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
  hermes = await installFakeHermes(page);
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Message Kana" })).toBeVisible();
});

/** Pick an option from one of Kana's custom dropdowns (no native select). */
async function chooseOption(scope: Locator, name: string, option: string): Promise<void> {
  await scope.getByRole("combobox", { name, exact: true }).click();
  await scope.getByRole("option", { name: option, exact: true }).click();
}

async function openHistory(page: Page): Promise<void> {
  const openHistory = page.getByRole("button", {
    name: "Open conversation history",
  });
  await openHistory.click();
}

test("never reveals a password and signs in with the operator-set one", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.goto("/login");
  const status = await page.request.get("/api/auth/status");
  const body = (await status.json()) as Record<string, unknown>;
  expect(body.passwordConfigured).toBe(true);
  expect(body).not.toHaveProperty("defaultPassword");
  await expect(page.getByText("chankana123")).toHaveCount(0);
  await page.getByLabel(/^(?:Password|Kata sandi)$/).fill(E2E_ACCESS_PASSWORD);
  await page.getByRole("button", { name: /^(?:Enter Kana|Masuk ke Kana)$/ }).click();
  await expect(page.getByRole("textbox", { name: "Message Kana" })).toBeVisible();
});

test("rejects cross-origin state-changing requests before authentication", async ({ page }) => {
  const forged = await page.request.post("/api/auth/logout", {
    headers: { Origin: "http://localhost:5173" },
  });
  expect(forged.status()).toBe(403);
});

test("renders text replies without entering the TTS pipeline when voice is off", async ({
  page,
}) => {
  let speechRequests = 0;
  await page.route("**/api/voice/tts/speech**", async (route) => {
    speechRequests += 1;
    await route.fulfill({ status: 503, body: "TTS must not be called." });
  });

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Voice/ }).click();
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

  // No fixed latency budget: slower laptops render later, and what matters is
  // that the reply shows without ever waiting on speech synthesis.
  await expect(page.getByText("Hello! I am here.", { exact: true }).first()).toBeVisible();
  expect(speechRequests).toBe(0);
});

test("shows files Hermes delivers as a player and download buttons, never as paths", async ({
  page,
}) => {
  // A tenth of a second of 8 kHz silence, a real WAV the player can load.
  const samples = 800;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  await page.route("**/api/media/**", (route) =>
    route.fulfill(
      route.request().url().includes("e2e-audio")
        ? { status: 200, body: wav, contentType: "audio/wav" }
        : { status: 200, body: "%PDF-1.4", contentType: "application/pdf" },
    ),
  );

  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("Send me the files");
  await composer.press("Enter");
  await expect(page.getByText("Hello! I am here.", { exact: true }).first()).toBeVisible();

  const audio = page.locator("audio.kana-media-audio");
  await expect(audio).toHaveCount(1);
  await expect(audio).toHaveAttribute("src", "/api/media/e2e-audio/tts_e2e.wav");
  await expect(audio).toBeVisible();
  await expect(page.getByRole("link", { name: "Download tts_e2e.wav" })).toHaveAttribute(
    "href",
    "/api/media/e2e-audio/tts_e2e.wav?download",
  );
  const report = page.getByRole("link", { name: "Download Laporan akhir.pdf" });
  await expect(report).toHaveAttribute("download", "Laporan akhir.pdf");
  await expect(page.getByText("Laporan akhir.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText(/MEDIA:/)).toHaveCount(0);
});

test("subtitles follow the language the user writes in and survive reloads", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("Hello Kana");
  await composer.press("Enter");

  const overlay = page.getByText("Hello! I am here.", { exact: true });
  await expect(overlay.first()).toBeVisible();

  await composer.fill("Halo Kana, apa kabar?");
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

test("keeps a running turn's Hermes activity through a refresh and renders its Markdown reply", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  const chat = page.getByRole("log", { name: "Live chat" });
  // A finished turn makes the session one a refresh resumes.
  await composer.fill("Hello Kana");
  await composer.press("Enter");
  await expect(chat.getByText("Hello! I am here.", { exact: true })).toBeVisible();

  await composer.fill("Research the Kupang weather");
  await composer.press("Enter");
  const activity = chat.getByRole("group").filter({ hasText: "Hermes activity" });
  await expect(activity).toContainText("web_search");
  await expect(activity).toHaveAttribute("open", "");

  // Hermes keeps working through a refresh; the tools it finished stay listed.
  await page.reload();
  await expect(composer).toBeVisible();
  await expect(activity).toContainText("web_search");
  await expect(activity).toHaveAttribute("open", "");

  // Open while the turn runs, unless the reader closes it: then it stays closed.
  await activity.locator("summary").click();
  await expect(activity).not.toHaveAttribute("open");
  await hermes.advanceHeldTurn();
  await expect(activity).toContainText("web_extract");
  await expect(activity).not.toHaveAttribute("open");
  await activity.locator("summary").click();
  await expect(activity).toHaveAttribute("open", "");

  // The reply collapses the turn's activity and reads as formatted text.
  await hermes.finishHeldTurn();
  await expect(chat.locator("strong", { hasText: "BMKG warning:" })).toBeVisible();
  await expect(activity).toHaveCount(1);
  await expect(activity).not.toHaveAttribute("open");
  await expect(activity).toContainText("2 steps");
  await expect(chat.getByRole("listitem")).toHaveCount(2);
  await expect(chat).not.toContainText("**");
  const source = chat.getByRole("link", { name: /example\.com\/indonesia/ });
  await expect(source).toHaveAttribute("href", /^https:\/\/www\.example\.com\/indonesia\//);
  await expect(source).toHaveAttribute("target", "_blank");
  // The long URL wraps inside its bubble instead of widening the chat.
  expect(await chat.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);
});

test("a refresh during a new conversation's first turn resumes it without a duplicate", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  const chat = page.getByRole("log", { name: "Live chat" });
  await openHistory(page);
  await page.getByText("New", { exact: true }).click();
  await composer.fill("Research the forest fires");
  await composer.press("Enter");
  const activity = chat.getByRole("group").filter({ hasText: "Hermes activity" });
  await expect(activity).toContainText("web_search");

  await page.reload();
  await expect(chat.getByText("Research the forest fires", { exact: true })).toBeVisible();
  await expect(activity).toContainText("web_search");
  await openHistory(page);
  await expect(page.getByRole("button", { name: /^Research the forest fires/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Untitled/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await hermes.finishHeldTurn();
  await expect(chat.getByText("Kupang weather")).toBeVisible();
});

test("persists the selected stage background across refreshes", async ({ page }) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", {
    name: /^Avatar(?: Avatar and stage)?$/,
  }).click();
  await page.getByRole("radio", {
    name: "Seigaiha",
    exact: true,
  }).click();
  await page.getByRole("button", { name: "Close settings" }).click();

  await expect(page.locator(".kana-stage-pattern")).toHaveAttribute(
    "data-background",
    "pattern-seigaiha",
  );

  await page.reload();
  await expect(page.locator(".kana-stage-pattern")).toHaveAttribute(
    "data-background",
    "pattern-seigaiha",
  );
});

test("the config guide opens from Settings and follows this installation", async ({
  page,
  context,
}) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Connection/ }).click();
  const guideLink = dialog.getByRole("link", { name: "Guide", exact: true });
  await expect(guideLink).toHaveAttribute("href", "/docs");
  // A new tab, so reading the guide never interrupts a conversation.
  await expect(guideLink).toHaveAttribute("target", "_blank");

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs");
  await expect(page.getByRole("heading", { level: 1, name: "Configuration guide" })).toBeVisible();
  await expect(page).toHaveTitle("Configuration guide · Kana");
  // This installation's own path, never a placeholder (and never the contents).
  await expect(page.getByTestId("config-guide-path")).toHaveText(/^\/.+\/config\.json$/);

  const contents = page.getByRole("navigation", { name: "Contents" });
  await contents.getByRole("link", { name: "Pollinations" }).click();
  await expect(contents.getByRole("link", { name: "Pollinations" })).toHaveAttribute("aria-current", "location");
  const pollinations = page.getByRole("region", { name: "Pollinations" });
  await expect(pollinations.getByRole("heading", { name: "Pollinations" })).toBeInViewport();

  await pollinations.getByRole("button", { name: "Copy" }).first().click();
  await expect(pollinations.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect((JSON.parse(copied) as { tts: { provider: string } }).tts.provider).toBe("pollinations");

  // The app locks html/body, so the guide scrolls in its own box; nothing in
  // it may push the page sideways, even on a phone.
  const sideways = await page.locator("main").evaluate((main) => {
    const scroller = main.closest(".overflow-y-auto") as HTMLElement;
    return scroller.scrollWidth - scroller.clientWidth;
  });
  expect(sideways).toBe(0);
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
  const horizontal = panel.getByRole("slider", { name: /^X$/ });
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
      .getByRole("slider", { name: /^X$/ }),
  ).toHaveValue("20");

  await trigger.click();
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: /^Avatar(?: Avatar and stage)?$/ }).click();
  await expect(page.getByRole("slider", { name: /^X$/ })).toHaveCount(0);
});

test("composer uploads files, preserves failed drafts, and removes attachments", async ({ page }) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  const picker = page.getByLabel("Choose files", { exact: true });
  let fail = true;
  const uploaded: Record<string, unknown>[] = [];
  await page.route("**/api/hermes/attachments", async (route) => {
    uploaded.push(route.request().postDataJSON());
    await route.fulfill({ status: fail ? 502 : 200, contentType: "application/json", body: JSON.stringify(fail ? { error: "Upload unavailable" } : { result: { attached: true, ref_text: '@file:"attachments/project notes.txt"' } }) });
  });
  await composer.fill("Please read these notes");
  await picker.setInputFiles({ name: "project notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello from browser") });
  await expect(page.getByRole("button", { name: "Remove project notes.txt" })).toBeVisible();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Upload unavailable" })).toBeVisible();
  await expect(composer).toHaveValue("Please read these notes");
  await expect(page.getByRole("button", { name: "Remove project notes.txt" })).toBeVisible();
  fail = false;
  const prompt = page.waitForRequest((request) => request.url().endsWith("/api/hermes/rpc") && request.postDataJSON()?.method === "prompt.submit");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect((await prompt).postDataJSON().params.text).toContain('@file:"attachments/project notes.txt"');
  await expect(composer).toHaveValue("");
  await expect(page.getByRole("button", { name: "Remove project notes.txt" })).toHaveCount(0);
  expect(uploaded.at(-1)?.dataUrl).toBe(`data:application/octet-stream;base64,${Buffer.from("hello from browser").toString("base64")}`);
  await picker.setInputFiles({ name: "remove.txt", mimeType: "text/plain", buffer: Buffer.from("remove me") });
  await page.getByRole("button", { name: "Remove remove.txt" }).click();
  await expect(page.getByRole("list", { name: "Attachments" })).toHaveCount(0);
});

test("composer selects the Hermes model and returns keyboard focus", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Choose model", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Choose model", exact: true });
  await chooseOption(dialog, "Provider", "OpenRouter");
  // Model lists can be long: the dropdown filters as you type and Enter picks.
  await dialog.getByRole("combobox", { name: "Model", exact: true }).click();
  const search = dialog.getByRole("combobox", { name: "Search models…" });
  await expect(search).toBeFocused();
  await search.fill("no such model");
  await expect(dialog.getByText("Nothing matches.")).toBeVisible();
  await search.fill("deepseek v4");
  await expect(dialog.getByRole("option", { name: "deepseek/deepseek-v4", exact: true })).toBeVisible();
  await search.press("Enter");
  await expect(dialog.getByRole("combobox", { name: "Model", exact: true })).toHaveText("deepseek/deepseek-v4");
  await dialog.getByRole("button", { name: "Use this model" }).click();
  // Exact: the model it replaces, deepseek-v4-flash-0731, contains this name.
  await expect(trigger).toHaveText(/^deepseek-v4\s*⌄$/);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.screenshot({ path: `test-results/composer-${test.info().project.name}.png` });
});

test("composer dictation appends only final speech to the editable draft", async ({ page }) => {
  await page.evaluate(() => {
    class FakeSpeech {
      onresult?: (event: unknown) => void;
      onend?: () => void;
      start() {
        setTimeout(() => {
          this.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "unfinished" } }] });
          this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "spoken words" } }] });
          this.onend?.();
        }, 20);
      }
      stop() { this.onend?.(); }
      abort() {}
    }
    Object.assign(window, { SpeechRecognition: FakeSpeech });
  });
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("My draft");
  await page.getByRole("button", { name: "Voice input", exact: true }).click();
  await expect(composer).toHaveValue("My draft spoken words");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await expect(page.getByRole("status").filter({ hasText: "Dictation complete" })).toBeVisible();
});

test("the composer names the session's model even when the list loads slower than the session opens", async ({
  page,
}) => {
  // A catalog request still in flight when the session opens used to be
  // dropped and never redone, leaving "Choose model" on the chip.
  await page.route("**/api/hermes/rpc", async (route) => {
    const body = route.request().postDataJSON() as { method?: string } | null;
    if (body?.method === "model.options") await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fallback();
  });
  await page.reload();
  const chip = page.getByRole("button", { name: "Choose model", exact: true });
  await expect(chip).toHaveText(/deepseek-v4-flash-0731/);

  // A new conversation opens its session with the first message.
  await openHistory(page);
  await page.getByText("New", { exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("Hello Kana");
  await composer.press("Enter");
  await expect(page.getByRole("log", { name: "Live chat" }).getByText("Hello! I am here.", { exact: true })).toBeVisible();
  await expect(chip).toHaveText(/deepseek-v4-flash-0731/);
});

test("changes the active Hermes model with an explicit provider", async ({ page }) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: /^AI model/ }).click();

  // The composer's model button and its dialog are also labelled "Model"; pick the settings selects.
  const dialog = page.getByRole("dialog");
  const modelSelect = dialog.getByRole("combobox", { name: "Model", exact: true });
  await expect(modelSelect).toHaveText("accounts/fireworks/models/deepseek-v4-flash-0731");
  await expect(dialog.getByRole("button", { name: "In use" })).toBeDisabled();
  await chooseOption(dialog, "Provider", "OpenRouter");
  await chooseOption(dialog, "Model", "deepseek/deepseek-v4");
  await page.getByRole("button", { name: "Use this model" }).click();

  await expect(page.getByText("The model for this conversation has been changed.")).toBeVisible();
  await expect(modelSelect).toHaveText("deepseek/deepseek-v4");
  await expect(dialog.getByRole("button", { name: "In use" })).toBeDisabled();
  // The composer's model button follows the switch through the cached catalog.
  await expect(page.getByRole("button", { name: "Choose model", exact: true })).toHaveAttribute("title", "deepseek/deepseek-v4");
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
    .getByRole("radiogroup", { name: "Interface language" })
    .getByRole("radio", { name: "Bahasa Indonesia", exact: true })
    .click();

  await expect(page.getByRole("heading", { name: "Pengaturan" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Pengalaman", exact: true })).toBeVisible();
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
  await expect(page.getByRole("radio", { name: "my-stage", exact: true })).toBeChecked();
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

  if (mobileChat) {
    // Chat-first phones: the avatar is a small call-style tile at the top left
    // and the transcript fills the rest of the screen below it.
    await expect(page.getByRole("button", { name: "Hide chat" })).toBeHidden();
    await expect(chatPanel).toHaveAttribute("aria-hidden", "false");
    await expect(avatarViewport).toHaveAttribute("data-chat-open", "true");
    const tile = await page.locator(".kana-stage-pattern").boundingBox();
    expect(tile).not.toBeNull();
    expect(tile!.x).toBeLessThan(24);
    expect(tile!.y).toBeLessThan(24);
    expect(tile!.width).toBeLessThan(viewportWidth / 3);
    const mobileLayout = await page.locator(".kana-chat-dock").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const feedStyle = getComputedStyle(
        element.querySelector(".kana-chat-scroll") as HTMLElement,
      );
      return {
        dockTop: bounds.top,
        dockBottom: bounds.bottom,
        fade: feedStyle.maskImage || feedStyle.webkitMaskImage,
      };
    });
    expect(mobileLayout.dockTop).toBeGreaterThanOrEqual(tile!.y + tile!.height);
    expect(mobileLayout.dockTop).toBeLessThan(viewportHeight * 0.3);
    expect(Math.round(mobileLayout.dockBottom)).toBe(viewportHeight);
    expect(mobileLayout.fade).not.toBe("none");
    await expect
      .poll(async () => (await avatarCanvas.evaluate((canvas) => (canvas as HTMLCanvasElement).width)))
      .toBeGreaterThan(0);
    return;
  }

  await expect
    .poll(async () => Math.round((await stage.boundingBox())?.width ?? 0))
    .toBe(viewportWidth);

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

  // Kana greets first, in view and unblurred, through a dialogue box. The
  // greeting is always English; the setup screens follow the UI language.
  const greeting = page.getByRole("dialog", { name: "Kana" });
  await expect(greeting).toBeVisible();
  await expect(greeting).toHaveAccessibleDescription(/^Hi, I'm Kana!/);
  await expect(greeting).toHaveAttribute("lang", "en");
  const start = greeting.getByRole("button", { name: "Let's go" });
  await expect(start).toBeFocused();
  await start.click();

  await expect(
    page.getByRole("heading", { name: "Buat percakapan terasa nyaman" }),
  ).toBeVisible();
  // Each step focuses its heading; Shift+Tab and Tab from there stay inside
  // the wizard instead of reaching the workspace behind it.
  await expect(page.getByRole("heading", { name: "Buat percakapan terasa nyaman" })).toBeFocused();
  const focusInsideWizard = () =>
    page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
  await page.keyboard.press("Shift+Tab");
  expect(await focusInsideWizard()).toBe(true);
  await page.getByRole("heading", { name: "Buat percakapan terasa nyaman" }).focus();
  await page.keyboard.press("Tab");
  expect(await focusInsideWizard()).toBe(true);
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
  await expect(page.getByText("The avatar couldn't load")).toBeVisible();
  await expect(page.getByText("Waiting for Live2D avatar")).toHaveCount(0);
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

function testToneWav(): Buffer {
  const samples = 16000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / 16000) * 12000), 44 + i * 2);
  return wav;
}

async function enableTestVoice(page: Page, type = "pollinations") {
  await page.route("**/api/voice/tts/provider", (route) => route.fulfill({ json: {
    provider: { id: type, type, name: "Test voice", configured: true, capabilities: {
      instruction: false, localInstall: type === "irodori-local", upstreamCancellation: true, voiceLibrary: false,
    } }, status: { state: "ready", voices: [], message: "Ready" },
  } }));
  await page.route("**/api/kana/voices**", (route) => route.fulfill({ json: { voices: [] } }));
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Voice/ }).click();
  await page.getByRole("switch", { name: "Japanese voice" }).check();
  await page.getByRole("button", { name: "Close settings" }).click();
}

for (const provider of ["irodori-local", "pollinations"]) {
  test(`TTS holds text until audible playback and runs lip sync for ${provider} without randomUUID`, async ({ page }) => {
    await enableTestVoice(page, provider);
    await page.evaluate(() => {
      Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
      const original = AnalyserNode.prototype.getByteTimeDomainData;
      AnalyserNode.prototype.getByteTimeDomainData = function (samples) {
        original.call(this, samples);
        if (samples.some((value) => value !== 128)) document.body.dataset.audioLipSync = "active";
      };
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let requests = 0;
    await page.route("**/api/voice/tts/speech", async (route) => {
      requests++;
      expect(route.request().postDataJSON().language).toBe("ja");
      await held;
      await route.fulfill({ contentType: "audio/wav", body: testToneWav() });
    });
    const composer = page.getByRole("textbox", { name: "Message Kana" });
    await composer.fill("Please speak after the audio is ready"); await composer.press("Enter");
    try {
      await expect.poll(() => requests).toBe(1);
      await expect(page.getByText("Hello! I am here.", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    } finally { release(); }
    await expect(page.getByText("Hello! I am here.", { exact: true }).first()).toBeVisible();
    await expect(page.locator("body")).toHaveAttribute("data-audio-lip-sync", "active");
    await expect(page.getByRole("button", { name: "Stop", exact: true })).not.toBeVisible();
  });
}

test("downloads the local voice engine only when asked and shows progress", async ({ page }) => {
  const actions: string[] = [];
  let polls = 0;
  const provider = { id: "irodori-local", type: "irodori-local", name: "Irodori TTS", configured: true, model: "Irodori-TTS v4.1 Anime", capabilities: { instruction: false, localInstall: true, upstreamCancellation: true, voiceLibrary: true } };
  const base = { engineInstalled: false, modelInstalled: false, modelSource: null, step: null, phase: null, completedBytes: 0, totalBytes: 0, downloadBytes: 3_544_900_182, requiredDiskBytes: 4_331_065_517, freeDiskBytes: 50_000_000_000, partialDownloadBytes: 0, int8: true, message: "" };
  await page.route("**/api/voice/tts/engine", async (route) => {
    if (route.request().method() === "POST") {
      actions.push(route.request().postDataJSON().action);
      return route.fulfill({ json: { provider, install: { ...base, state: "installing", step: "engine", phase: "downloading", completedBytes: 0, totalBytes: 3_544_900_182 } } });
    }
    if (!actions.length) return route.fulfill({ json: { provider, install: { ...base, state: "not_installed" } } });
    polls += 1;
    return route.fulfill({ json: { provider, install: polls < 2
      ? { ...base, state: "installing", step: "model", phase: "downloading", completedBytes: 1_772_450_091, totalBytes: 3_544_900_182 }
      : { ...base, state: "ready", engineInstalled: true, modelInstalled: true, modelSource: "download", downloadBytes: 0, requiredDiskBytes: 0 } } });
  });
  await page.route("**/api/kana/voices**", (route) => route.fulfill({ json: { voices: [], supportsVoiceLibrary: true } }));
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Voice/ }).click();
  const engine = dialog.getByRole("region", { name: "Local voice engine" });
  await expect(engine.getByText("Not downloaded")).toBeVisible();
  await expect(engine.getByText(/^3\.3 GB download$/)).toBeVisible();
  expect(actions).toEqual([]);

  await engine.getByRole("button", { name: "Download voice engine" }).click();
  await expect(engine.getByRole("progressbar")).toBeVisible();
  await expect(engine.getByText(/Downloading model · 50%/)).toBeVisible();
  await expect(engine.getByText("Installed")).toBeVisible({ timeout: 10_000 });
  expect(actions).toEqual(["install"]);
});

test("TTS failure reveals held text with an explicit voice error", async ({ page }) => {
  await enableTestVoice(page);
  await page.route("**/api/voice/tts/speech", (route) => route.fulfill({ status: 503, json: { error: "Test voice unavailable" } }));
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("Handle an unavailable voice"); await composer.press("Enter");
  await expect(page.getByText("Hello! I am here.", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Test voice unavailable/).first()).toBeVisible();
});

test("a failed spoken reply does not suppress an identical answer to a new user turn", async ({ page }) => {
  await enableTestVoice(page);
  let count = 0;
  await page.route("**/api/voice/tts/speech", (route) => {
    count++;
    return count === 1
      ? route.fulfill({ status: 503, json: { error: "Temporary voice failure" } })
      : route.fulfill({ contentType: "audio/wav", body: testToneWav() });
  });
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("First greeting"); await composer.press("Enter");
  await expect(page.getByText("Hello! I am here.", { exact: true })).toHaveCount(1);
  await composer.fill("Say that again"); await composer.press("Enter");
  await expect.poll(() => count).toBe(2);
  await expect(page.getByText("Hello! I am here.", { exact: true })).toHaveCount(2);
});

test("Stop reveals held text and cancels synthesis before playback", async ({ page }) => {
  await enableTestVoice(page);
  let requested = false;
  let cancelled = false;
  await page.route("**/api/voice/tts/speech", () => { requested = true; });
  await page.route("**/api/voice/tts/requests/*/cancel", (route) => {
    cancelled = true; return route.fulfill({ json: { cancelled: true } });
  });
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("Stop this pending voice"); await composer.press("Enter");
  await expect.poll(() => requested).toBe(true);
  await expect(page.getByText("Hello! I am here.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByText("Hello! I am here.", { exact: true }).first()).toBeVisible();
  await expect.poll(() => cancelled).toBe(true);
});

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { E2E_ACCESS_PASSWORD } from "./access-password";

/** Submit the draft as the current device does: Enter on desktop, Send on a phone. */
async function submitDraft(page: Page, composer: Locator) {
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await page.getByRole("button", { name: "Send", exact: true }).click();
  } else {
    await composer.press("Enter");
  }
}

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
  /** Slash commands Hermes received, in order, as `slash.exec` saw them (no leading slash). */
  commands: string[];
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
  // Slash commands as Hermes received them, so a journey can prove what ran.
  const receivedCommands: string[] = [];
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
        tokenAvailable: true,
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
      case "complete.slash": {
        // Like Hermes: name-prefix matches, so a partial command arrives with
        // its nearest real name on screen.
        const typed = String(body.params?.text ?? "").trim().split(/\s+/, 1)[0].toLowerCase();
        const names = ["/status", "/new", "/codex-runtime"];
        const matched = typed.startsWith("/")
          ? names.filter((name) => name.startsWith(typed))
          : [];
        result = {
          replace_from: 0,
          items: matched.map((name) => ({ text: name, display: name })),
        };
        break;
      }
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
        receivedCommands.push(command);
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
        if (noteStart === -1 || !/\n---\n(?:ja|emotion): /.test(submitted.slice(noteStart))) {
          throw new Error("Kana sent no response contract.");
        }
        // With Kana's voice off the note asks for no Japanese speech.
        const speaks = /\n---\nja: /.test(submitted.slice(noteStart));
        const userMessage = submitted.slice(0, noteStart);
        const language = /\b(halo|aku|kamu|apa)\b/i.test(userMessage) ? "id" : "en";
        // Hermes's default busy_input_mode redirects the live turn instead of
        // opening a second one; no second completion may follow.
        if (session?.running) {
          session.history.push({ role: "user", text: submitted });
          result = { status: "redirected" };
          break;
        }
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
          ...(speaks ? ["ja: こんにちは、ここにいます。"] : []),
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
    commands: receivedCommands,
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

/**
 * Waits for one round-trip the test itself controls, so a request the UI may
 * have wrongly fired on a click has definitely reached the route handler (or a
 * `page.on("request")` listener) before the caller asserts against it. A
 * synchronous `expect(requests).toEqual([])` cannot: right after a click the
 * request would still be in flight through CDP, so the assertion passes
 * whether or not the click was supposed to send anything.
 */
async function settleNetwork(page: Page, url: string): Promise<void> {
  await page.evaluate(async (target) => {
    await fetch(target, { cache: "no-store" });
  }, url);
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

test("shows only this install's password command until a password exists", async ({ page, context }) => {
  await context.clearCookies();
  let configured = false;
  await page.route("**/api/auth/status", (route) =>
    route.fulfill({
      json: configured
        ? { authEnabled: true, authenticated: false, passwordConfigured: true, deploymentMode: "local" }
        : {
            authEnabled: true,
            authenticated: false,
            passwordConfigured: false,
            passwordCommand: "kana password",
            deploymentMode: "local",
          },
    }),
  );
  await page.goto("/login");
  await expect(page.locator("pre code")).toHaveText("kana password");
  await expect(page.getByText("npm run password")).toHaveCount(0);
  await expect(page.getByLabel(/^(?:Password|Kata sandi)$/)).toHaveCount(0);
  // Once the command has run, the sign-in form appears without a reload.
  configured = true;
  await expect(page.getByLabel(/^(?:Password|Kata sandi)$/)).toBeVisible({ timeout: 10_000 });
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
  await submitDraft(page, composer);

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
  await submitDraft(page, composer);
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

test("copies a bubble's text, and a reply's words rather than its hidden file links", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("Keep this prompt");
  await submitDraft(page, composer);

  const feed = await page.locator(".kana-chat-feed").boundingBox();
  const feedMiddle = (feed?.x ?? 0) + (feed?.width ?? 0) / 2;

  // A reply's copy button sits under its bubble — never in the bubble's fill —
  // and on the left, where the reply itself starts.
  await expect(page.getByText("Hello! I am here.", { exact: true }).first()).toBeVisible();
  const reply = page.locator("article").filter({ hasText: "Hello! I am here." }).last();
  const replyCopy = reply.getByRole("button", { name: "Copy message" });
  const replyBubble = await reply.locator(".kana-message-assistant").boundingBox();
  const replyButton = await replyCopy.boundingBox();
  expect(replyBubble && replyButton).toBeTruthy();
  expect(
    (replyButton?.y ?? 0) - ((replyBubble?.y ?? 0) + (replyBubble?.height ?? 0)),
  ).toBeGreaterThanOrEqual(0);
  expect(replyButton?.x ?? 0).toBeLessThan(feedMiddle);

  await replyCopy.click();
  await expect(reply.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Hello! I am here.");

  // A reply that delivered files copies its words: the MEDIA: links are a
  // player and download buttons on screen, never text to paste somewhere else.
  await composer.fill("Send me the files");
  await submitDraft(page, composer);
  await expect(page.getByText("Hello! I am here.", { exact: true })).toHaveCount(2);
  const withFiles = page.locator("article").filter({ hasText: "Hello! I am here." }).last();
  await withFiles.getByRole("button", { name: "Copy message" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Hello! I am here.");

  // The reader's own bubbles keep their button on the right, and only the one
  // pointed at shows it — a touch screen, which cannot point, shows them all.
  const sent = page.locator("article").filter({ hasText: "Keep this prompt" }).last();
  const other = page.locator("article").filter({ hasText: "Send me the files" }).last();
  const sentCopy = sent.getByRole("button", { name: "Copy message" });
  const otherCopy = other.getByRole("button", { name: "Copy message" });
  expect((await sentCopy.boundingBox())?.x ?? 0).toBeGreaterThan(feedMiddle);

  // The pointer sits on the reply copied a moment ago, so it has to leave the
  // chat before either quiet button can be judged.
  await page.mouse.move(0, 0);
  if (await page.evaluate(() => window.matchMedia("(hover: hover)").matches)) {
    await expect(sentCopy).toHaveCSS("opacity", "0");
    await expect(otherCopy).toHaveCSS("opacity", "0");
    await sent.hover();
    await expect(sentCopy).toHaveCSS("opacity", "1");
    await expect(otherCopy).toHaveCSS("opacity", "0");
  } else {
    // A touch screen has no pointer to hover with, so the button is simply
    // there — pointing at nothing at all still leaves it on screen.
    await expect(sentCopy).toHaveCSS("opacity", "1");
  }

  await sentCopy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Keep this prompt");
});

test("keeps the avatar chat tray blue and gives focus mode a plain reading column", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("Style check");
  await submitDraft(page, composer);
  await expect(page.getByText("Hello! I am here.", { exact: true }).first()).toBeVisible();

  const readStyles = () =>
    page.evaluate(() => {
      const resolve = (name: string) => {
        const probe = document.createElement("span");
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      };
      const read = (selector: string) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const computed = getComputedStyle(node);
        return {
          background: computed.backgroundColor,
          borderTop: computed.borderTopWidth,
          paddingTop: computed.paddingTop,
        };
      };
      return {
        surface: resolve("--surface"),
        surfaceStrong: resolve("--surface-strong"),
        accent: resolve("--accent"),
        frame: resolve("--chat-frame"),
        depth: resolve("--chat-depth"),
        bubble: resolve("--chat-bubble"),
        panel: read(".kana-chat-panel"),
        feed: read(".kana-chat-feed"),
        shell: read(".kana-composer-shell"),
        field: read(".kana-composer"),
        assistant: read(".kana-message-assistant"),
        send: read(".kana-send"),
      };
    });

  const desktop = (page.viewportSize()?.width ?? 0) >= 1024;
  const withAvatar = await readStyles();
  if (desktop) {
    // The avatar keeps the original tray: blue replies, blue composer band,
    // the depth fill, and the narrow dock.
    expect(withAvatar.assistant?.background).toBe(withAvatar.bubble);
    expect(withAvatar.shell?.background).toBe(withAvatar.frame);
    expect(withAvatar.feed?.background).toBe(withAvatar.depth);
    expect(withAvatar.field?.borderTop).toBe("0px");
    const avatarDock = await page.locator(".kana-chat-dock").boundingBox();
    expect(avatarDock?.width ?? 0).toBeGreaterThanOrEqual(390);
    expect(avatarDock?.width ?? 0).toBeLessThanOrEqual(481);
  } else {
    expect(withAvatar.shell?.background).toBe(withAvatar.frame);
    expect(withAvatar.assistant?.background).toBe(withAvatar.bubble);
    expect(withAvatar.feed?.background).toBe("rgba(0, 0, 0, 0)");
    expect(withAvatar.field?.borderTop).toBe("0px");
  }

  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Avatar(?: Avatar and stage)?$/ }).click();
  await dialog.getByRole("switch", { name: "Show avatar" }).click();
  await dialog.getByRole("button", { name: "Close settings" }).click();
  await expect(page.locator(".kana-chat-dock")).toHaveClass(/is-sole/);

  // Enables Send so its painted state can be read, too.
  await composer.fill("draft");
  const focus = await readStyles();
  if (desktop) {
    // Focus mode is one clean reading surface inside the blue frame.
    expect(focus.panel?.background).toBe(focus.surface);
    expect(focus.feed?.background).toBe(focus.surface);
    expect(focus.shell?.background).toBe(focus.surface);

    // A reply is plain text, not a fill or a box.
    expect(focus.assistant?.background).toBe("rgba(0, 0, 0, 0)");
    expect(focus.assistant?.borderTop).toBe("0px");
    expect(focus.assistant?.paddingTop).toBe("0px");

    // The composer is a filled bar with an accent Send.
    expect(focus.field?.background).toBe(focus.surfaceStrong);
    expect(focus.field?.borderTop).toBe("0px");
    expect(focus.send?.background).toBe(focus.accent);

    // The panel spans the desktop's working width, but the conversation and
    // the composer bar stay on one narrow measure, centred inside it.
    const dock = await page.locator(".kana-chat-dock").boundingBox();
    expect(dock?.width ?? 0).toBeGreaterThanOrEqual(
      (page.viewportSize()?.width ?? 0) * 0.7,
    );
    const scroll = await page.locator(".kana-chat-scroll").boundingBox();
    const bar = await page.locator(".kana-composer").boundingBox();
    expect(scroll && bar && dock).toBeTruthy();
    expect(scroll!.width).toBeLessThanOrEqual(808);
    expect(bar!.width).toBeLessThanOrEqual(760);
    for (const narrow of [scroll!, bar!]) {
      const leftGap = narrow.x - dock!.x;
      const rightGap = dock!.x + dock!.width - (narrow.x + narrow.width);
      expect(Math.abs(leftGap - rightGap)).toBeLessThan(2);
    }
    // The bar shares the transcript's text edges, not the panel's.
    expect(Math.abs(bar!.x - (scroll!.x + 24))).toBeLessThan(2);
    expect(
      Math.abs(bar!.x + bar!.width - (scroll!.x + scroll!.width - 24)),
    ).toBeLessThan(2);

    // The bar is one pill row: attach, draft, model, mic, Send.
    const attachBox = await page.locator(".kana-composer-attach").boundingBox();
    const textBox = await page.locator(".kana-composer textarea").boundingBox();
    const modelBox = await page.locator(".kana-model-pill").boundingBox();
    const micBox = await page
      .locator(".kana-composer-tool:not(.kana-composer-attach)")
      .boundingBox();
    const sendBox = await page.locator(".kana-send").boundingBox();
    expect(attachBox && textBox && modelBox && micBox && sendBox).toBeTruthy();
    const centers = [attachBox, textBox, modelBox, micBox, sendBox].map(
      (box) => box!.y + box!.height / 2,
    );
    for (const center of centers) {
      expect(Math.abs(center - centers[0])).toBeLessThan(2);
    }
    expect(attachBox!.x + attachBox!.width).toBeLessThanOrEqual(textBox!.x + 1);
    expect(textBox!.x + textBox!.width).toBeLessThanOrEqual(modelBox!.x + 1);
    expect(modelBox!.x + modelBox!.width).toBeLessThanOrEqual(micBox!.x + 1);
    expect(micBox!.x + micBox!.width).toBeLessThanOrEqual(sendBox!.x + 1);

    // The reader's own words keep a bubble on the right.
    const feed = await page.locator(".kana-chat-feed").boundingBox();
    const sent = await page
      .locator('article[data-role="user"]')
      .first()
      .boundingBox();
    expect(sent && feed).toBeTruthy();
    expect((sent?.x ?? 0) + (sent?.width ?? 0)).toBeGreaterThan(
      (feed?.x ?? 0) + (feed?.width ?? 0) * 0.75,
    );
  } else {
    // Phones keep today's blue band and bubble with the avatar off, too.
    expect(focus.shell?.background).toBe(focus.frame);
    expect(focus.assistant?.background).toBe(focus.bubble);
    expect(focus.feed?.background).toBe("rgba(0, 0, 0, 0)");
    expect(focus.field?.borderTop).toBe("0px");
    expect(focus.field?.background).toBe("rgba(0, 0, 0, 0)");
  }
});

test("subtitles follow the language the user writes in and survive reloads", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("Hello Kana");
  await submitDraft(page, composer);

  const overlay = page.getByText("Hello! I am here.", { exact: true });
  await expect(overlay.first()).toBeVisible();

  await composer.fill("Halo Kana, apa kabar?");
  await submitDraft(page, composer);
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

test("walks this conversation's sent prompts with the arrow keys", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("First prompt");
  await submitDraft(page, composer);
  await expect(page.getByText("Hello! I am here.", { exact: true }).first()).toBeVisible();
  await composer.fill("Second prompt");
  await submitDraft(page, composer);
  await expect(page.getByText("Hello! I am here.", { exact: true })).toHaveCount(2);

  // Only the desktop walks history; a phone keeps the keys for its caret.
  const desktop = (page.viewportSize()?.width ?? 0) >= 1024;
  await composer.fill("half typed");
  await composer.press("ArrowUp");
  await expect(composer).toHaveValue(desktop ? "Second prompt" : "half typed");
  if (!desktop) return;

  await composer.press("ArrowUp");
  await expect(composer).toHaveValue("First prompt");
  await composer.press("ArrowDown");
  await expect(composer).toHaveValue("Second prompt");
  // Past the newest prompt the walk gives the unsent draft back.
  await composer.press("ArrowDown");
  await expect(composer).toHaveValue("half typed");

  // A draft with real line breaks keeps both keys while the caret has a line to
  // move to, and a live draft has nothing newer behind it.
  await composer.fill("first line\nsecond line");
  await composer.press("ArrowDown");
  await expect(composer).toHaveValue("first line\nsecond line");
  await composer.press("ArrowUp");
  await expect(composer).toHaveValue("first line\nsecond line");
  // The caret is on the first line now, so this ArrowUp recalls.
  await composer.press("ArrowUp");
  await expect(composer).toHaveValue("Second prompt");
  // Coming back past the newest prompt returns the whole draft, line breaks and all.
  await composer.press("ArrowDown");
  await expect(composer).toHaveValue("first line\nsecond line");
});

test("keeps a running turn's Hermes activity through a refresh and renders its Markdown reply", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  const chat = page.getByRole("log", { name: "Live chat" });
  // A finished turn makes the session one a refresh resumes.
  await composer.fill("Hello Kana");
  await submitDraft(page, composer);
  await expect(chat.getByText("Hello! I am here.", { exact: true })).toBeVisible();

  await composer.fill("Research the Kupang weather");
  await submitDraft(page, composer);
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

test("a message typed during a turn is redirected into it, not answered twice", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  const chat = page.getByRole("log", { name: "Live chat" });

  await composer.fill("Research the Kupang weather");
  await submitDraft(page, composer);
  const activity = chat.getByRole("group").filter({ hasText: "Hermes activity" });
  await expect(activity).toContainText("web_search");
  // Send stays Send while Hermes works; stopping lives beside the status.
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();

  await composer.fill("and the folders too");
  await submitDraft(page, composer);
  // The redirected message is a line under the message that opened the turn,
  // not a second bubble.
  const turn = chat.locator("article").filter({ hasText: "Research the Kupang weather" });
  await expect(
    turn.getByText("Redirected current turn: 'and the folders too'", { exact: true }),
  ).toBeVisible();
  await expect(turn.locator("[data-correction='redirected']")).toHaveCount(1);
  await expect(chat.locator("article").filter({ hasText: "and the folders too" })).toHaveCount(1);
  await expect(
    page.getByText("Message added to the current turn", { exact: true }),
  ).toBeVisible();

  await hermes.finishHeldTurn();
  await expect(chat.locator("strong", { hasText: "BMKG warning:" })).toHaveCount(1);
  await expect(chat.getByText("Hello! I am here.", { exact: true })).toHaveCount(0);
  await expect(activity).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).not.toBeVisible();
});

test("a refresh during a new conversation's first turn resumes it without a duplicate", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  const chat = page.getByRole("log", { name: "Live chat" });
  await openHistory(page);
  await page.getByText("New", { exact: true }).click();
  await composer.fill("Research the forest fires");
  await submitDraft(page, composer);
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

test("Settings → Connection separates Hermes state from its one useful action", async ({
  page,
}) => {
  const runtimeStatus = {
    controlAvailable: true,
    state: "running",
    managed: true,
    executable: "/home/user/.local/bin/hermes",
    pid: 4242,
    port: 9119,
    websocketUrl: "ws://127.0.0.1:9119/api/ws",
    tokenAvailable: true,
    message: "Hermes UI gateway is running under Kana.",
  };
  const actions: string[] = [];
  await page.route("**/api/local-runtime/hermes*", async (route) => {
    if (route.request().method() === "POST") {
      actions.push(route.request().postDataJSON().action);
      await route.fulfill({ json: runtimeStatus });
      return;
    }
    await route.fulfill({ json: runtimeStatus });
  });

  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog");
  const openConnection = async () => {
    await dialog.getByRole("button", { name: /^Connection/ }).click();
    return dialog.getByRole("region", { name: "Hermes process control" });
  };
  // Settings reads the runtime once per open, so each state is a fresh open.
  const reopen = async () => {
    await dialog.getByRole("button", { name: "Close settings" }).click();
    await page.getByRole("button", { name: "Open settings" }).click();
    return openConnection();
  };
  let hermes = await openConnection();

  // One state, in Kana's words, plus plain facts on their own rows. The
  // server's technical message, its PID, and its endpoint stay out of the
  // browser's reading.
  await expect(hermes.getByText("Running", { exact: true })).toBeVisible();
  await expect(hermes.getByText("Port", { exact: true })).toBeVisible();
  await expect(hermes.getByText("9119", { exact: true })).toBeVisible();
  await expect(hermes.getByText("Managed by", { exact: true })).toBeVisible();
  await expect(hermes.getByText("Kana", { exact: true })).toBeVisible();
  await expect(hermes.getByTitle("Started by Kana.")).toBeVisible();
  await expect(hermes.getByText(runtimeStatus.message)).toHaveCount(0);
  await expect(hermes.getByText("4242")).toHaveCount(0);

  // One identity row: the state chip and the two actions, and no refresh button.
  await expect(hermes.getByText("Actions", { exact: true })).toHaveCount(0);
  await expect(hermes.getByRole("button", { name: "Refresh status" })).toHaveCount(0);
  const restart = hermes.getByRole("button", { name: "Restart", exact: true });
  const stop = hermes.getByRole("button", { name: "Stop", exact: true });
  await expect(restart).toBeVisible();
  await expect(stop).toBeVisible();
  // The actions keep the right side of the row at phone width too.
  const hermesLabel = await hermes.getByText("Hermes", { exact: true }).boundingBox();
  const restartBox = await restart.boundingBox();
  expect(restartBox!.x).toBeGreaterThan(hermesLabel!.x + hermesLabel!.width);

  // Restarting closes every Hermes session, so it asks before it acts.
  await restart.click();
  await expect(hermes.getByRole("button", { name: "Yes, restart?", exact: true })).toBeVisible();
  await expect(hermes.getByRole("button", { name: "Restart", exact: true })).toHaveCount(0);
  // Arming must not restart anything. A round-trip the test itself controls is
  // awaited first, so a request the click had wrongly fired has already been
  // received by the time this runs instead of still being in flight.
  await settleNetwork(page, "/api/local-runtime/hermes");
  expect(actions).toEqual([]);
  await hermes.getByRole("button", { name: "Yes, restart?", exact: true }).click();
  await expect.poll(() => actions).toEqual(["restart"]);
  await expect(hermes.getByText("Hermes restarted.")).toBeVisible();
  await page.screenshot({ path: `test-results/connection-${test.info().project.name}.png` });

  // A Hermes Kana adopted is left alone, so there is nothing to press.
  await page.route("**/api/local-runtime/hermes*", (route) =>
    route.fulfill({ json: { ...runtimeStatus, managed: false } }),
  );
  hermes = await reopen();
  await expect(hermes.getByText("Not managed by Kana", { exact: true })).toBeVisible();
  await expect(hermes.getByTitle("Started outside Kana, so Kana cannot restart or stop it.")).toBeVisible();
  await expect(hermes.getByRole("button", { name: /restart|stop/i })).toHaveCount(0);

  // Without process control the panel says so instead of offering dead buttons.
  await page.route("**/api/local-runtime/hermes*", (route) =>
    route.fulfill({ json: { ...runtimeStatus, controlAvailable: false, state: "disabled" } }),
  );
  hermes = await reopen();
  await expect(hermes.getByText("Unavailable")).toBeVisible();
  await expect(hermes.getByTitle("Process control is available only through the Kana launcher (`kana serve`).")).toBeVisible();
  await expect(hermes.getByRole("button", { name: /^(?:Start|Stop|Restart)$/ })).toHaveCount(0);
});

/** The frozen update API contract this journey asserts against. */
const UPDATE_STATUS = {
  currentVersion: "0.4.1",
  update: { latestVersion: "0.5.0", installCommand: "npm i -g kana-alya@latest" },
};

/**
 * The update notice, told apart from the degraded-service banner by its text:
 * both wear the same square `.kana-notice` box in the workspace, not Settings.
 */
function updateNotice(page: Page): Locator {
  return page.locator(".kana-notice").filter({ hasText: "New Version Available" });
}

type SeenRequest = { method: string; path: string; body: string };

/** Every request the page makes, so a journey can prove what Kana never runs. */
function recordRequests(page: Page): SeenRequest[] {
  const requests: SeenRequest[] = [];
  page.on("request", (request) => {
    let path = request.url();
    try {
      path = new URL(request.url()).pathname;
    } catch {
      // A data:/blob: URL is never part of the update surface.
    }
    let body = "";
    try {
      body = request.postData() ?? "";
    } catch {
      body = "";
    }
    requests.push({ method: request.method(), path, body });
  });
  return requests;
}

/** Kana copies the command for the user; it must never send one, or run npm. */
function expectNoInstallRequest(requests: SeenRequest[]): void {
  const installLike = requests.filter((request) =>
    /npm\s+(?:i|install)\s+-g|kana-alya@latest/.test(`${request.path} ${request.body}`),
  );
  expect(installLike).toEqual([]);
}

/**
 * The copy button by its visible label: its accessible name also carries the
 * versions and the command, so the visible text is what identifies it.
 */
function copyCommandButton(page: Page): Locator {
  return updateNotice(page).getByRole("button").filter({ hasText: "Copy Command" });
}

/**
 * The notice's one action, whatever label it currently wears: it reads "Copy
 * Command" until the copy lands and "Command Copied" afterwards.
 */
function noticeAction(page: Page): Locator {
  return updateNotice(page).getByRole("button");
}

/**
 * The same button after a landed copy, by the exact label the contract gives
 * it: filtering on the visible text keeps the modal's own buttons out even if
 * the modal renders inside the notice's box.
 */
function copiedCommandButton(page: Page): Locator {
  return updateNotice(page).getByRole("button").filter({ hasText: "Command Copied" });
}

/**
 * The stop dialog, told apart from any other dialog by the command it shows:
 * the confirmation is the one place that renders the install command.
 */
function updateDialog(page: Page): Locator {
  return page.getByRole("dialog").filter({ hasText: "npm i -g kana-alya@latest" });
}

/** The one action that stops Kana: inside that dialog, never in the notice. */
function shutdownButton(page: Page): Locator {
  return updateDialog(page).getByRole("button", { name: "Copy & Shutdown", exact: true });
}

/** The `/api/update/stop` requests the recorder saw: the only stop Kana knows. */
function stopRequests(requests: SeenRequest[]): SeenRequest[] {
  return requests.filter((request) => request.path === "/api/update/stop");
}

/** Copies the command, then waits for the clipboard and the modal it opens. */
async function copyInstallCommand(page: Page): Promise<void> {
  await copyCommandButton(page).click();
  // The strongest statement that Kana installs nothing: the user, not Kana,
  // ends up holding the exact command.
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("npm i -g kana-alya@latest");
  await expect(page.getByRole("dialog")).toHaveCount(1);
}

test("shows the workspace update notice and stops Kana only after Copy & Shutdown", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/update", (route) => route.fulfill({ json: UPDATE_STATUS }));
  const stops: unknown[] = [];
  await page.route("**/api/update/stop", async (route) => {
    stops.push(route.request().postDataJSON());
    await route.fulfill({ json: { stopping: true } });
  });
  const requests = recordRequests(page);

  await page.goto("/");
  const notice = updateNotice(page);
  await expect(notice).toBeVisible();

  // The visible line is only the title: both versions and the exact command
  // live in its tooltip, and the old "New Version Available: 0.5.0 (installed
  // 0.4.1)" line is gone. Matching the title by its own exact text is itself
  // the proof that no version number shares that line.
  const titleLine = notice.getByText("New Version Available", { exact: true });
  await expect(titleLine).toBeVisible();
  await expect(notice.getByText(/New Version Available:/)).toHaveCount(0);
  await expect(titleLine).toHaveAttribute("title", /0\.5\.0/);
  await expect(titleLine).toHaveAttribute("title", /0\.4\.1/);
  await expect(titleLine).toHaveAttribute("title", /npm i -g kana-alya@latest/);

  // The copy button names both versions and the command too, for touch and
  // screen-reader users who never see a tooltip, while its visible label is
  // exactly "Copy Command" (no version numbers on the line).
  await expect(notice.getByRole("button", { name: /0\.5\.0/ })).toHaveCount(1);
  await expect(notice.getByRole("button", { name: /0\.4\.1/ })).toHaveCount(1);
  await expect(notice.getByRole("button", { name: /npm i -g kana-alya@latest/ })).toHaveCount(1);
  const copy = copyCommandButton(page);
  await expect(copy).toHaveCount(1);
  await expect(copy).toHaveText("Copy Command");
  // One action, and no second way to stop Kana: `exact` so a substring of a
  // longer label could never satisfy it.
  await expect(noticeAction(page)).toHaveCount(1);
  await expect(notice.getByRole("button", { name: "Stop Kana", exact: true })).toHaveCount(0);
  await expect(notice.getByRole("button", { name: "Yes, Stop Kana", exact: true })).toHaveCount(0);
  await expect(notice.getByRole("button", { name: "Copy & Shutdown", exact: true })).toHaveCount(0);

  // Nothing can stop Kana before the command is copied, and no dialog exists
  // yet. A round-trip the test controls is awaited first, so a request the UI
  // may have wrongly fired has already been received before this asserts.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await settleNetwork(page, "/api/update");
  expect(stopRequests(requests)).toEqual([]);
  expect(stops).toEqual([]);

  await copyInstallCommand(page);

  // The copy is the only thing that opens the modal, and the button now says
  // so exactly.
  const copied = copiedCommandButton(page);
  await expect(copied).toHaveCount(1);
  await expect(copied).toHaveText("Command Copied");
  await expect(copied).toBeVisible();

  // The modal names the target version, shows the exact command, and walks
  // through the three steps that follow the copy.
  const dialog = updateDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toContainText("0.5.0");
  await expect(dialog).toContainText(/Update Kana to/);
  await expect(dialog.locator("code")).toHaveText("npm i -g kana-alya@latest");
  await expect(dialog.getByRole("listitem")).toHaveCount(3);
  await expect
    .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(shutdownButton(page)).toBeVisible();
  // Reading the steps is not a decision: copying opens the modal, and the
  // modal stops nothing on its own, so there is no timer to wait out. The
  // round-trip makes a request fired by the copy, the focus move, or the modal
  // paint impossible to miss.
  await settleNetwork(page, "/api/update");
  expect(stopRequests(requests)).toEqual([]);
  expect(stops).toEqual([]);

  // The only two things the modal offers, and neither stops anything yet.
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Copy & Shutdown", exact: true })).toHaveCount(1);

  // Only Copy & Shutdown stops Kana, and exactly once.
  await shutdownButton(page).click();
  await expect.poll(() => stops).toEqual([{ confirm: true }]);
  expect(stops).toHaveLength(1);
  await expect(page.getByText(/Kana is stopping/).first()).toBeVisible();

  // The POST really carried the confirmation the route requires.
  const sent = stopRequests(requests);
  expect(sent).toHaveLength(1);
  expect(sent[0].method).toBe("POST");
  expect(sent[0].body).toContain('"confirm":true');

  // Kana never installs anything itself: no request carries the command, and
  // the only update routes it ever calls are the two documented ones.
  expectNoInstallRequest(requests);
  const updatePaths = new Set(
    requests.filter((request) => request.path.startsWith("/api/update")).map((request) => request.path),
  );
  expect(updatePaths).toEqual(new Set(["/api/update", "/api/update/stop"]));
});

test("keeps the update notice retryable when stopping Kana fails", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/update", (route) => route.fulfill({ json: UPDATE_STATUS }));
  const stops: unknown[] = [];
  let mode: "error" | "drop" = "error";
  await page.route("**/api/update/stop", async (route) => {
    stops.push(route.request().postDataJSON());
    if (mode === "drop") return route.abort("connectionfailed");
    return route.fulfill({ status: 503, json: { error: "Stop unavailable" } });
  });
  // Copy, then ask the modal to shut Kana down; the modal stays open so the
  // same button can be pressed again.
  const stopOnce = async () => {
    await copyInstallCommand(page);
    await shutdownButton(page).click();
    return updateDialog(page);
  };

  // A server that refuses the stop says so, and never claims Kana is stopping.
  await page.goto("/");
  await stopOnce();
  await expect.poll(() => stops.length).toBe(1);
  await expect(page.getByText(/could not be stopped/).first()).toBeVisible();
  await expect(page.getByText(/Kana is stopping/)).toHaveCount(0);
  // Retryable, not a dead end: the same button asks again, and `exact` keeps
  // a longer or shorter label from satisfying it.
  await expect(shutdownButton(page)).toBeVisible();
  await expect(shutdownButton(page)).toBeEnabled();

  // A stop request that never reaches Kana must end the same way.
  mode = "drop";
  await page.reload();
  await stopOnce();
  await expect.poll(() => stops.length).toBe(2);
  await expect(page.getByText(/could not be stopped/).first()).toBeVisible();
  await expect(page.getByText(/Kana is stopping/)).toHaveCount(0);
  await expect(shutdownButton(page)).toBeVisible();
  await expect(shutdownButton(page)).toBeEnabled();
  // The retry goes through the same route, with the same confirmation.
  await shutdownButton(page).click();
  await expect.poll(() => stops.length).toBe(3);
  expect(stops.at(-1)).toEqual({ confirm: true });
});

test("closes the update notice's dialog from Cancel or Escape without stopping Kana", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/update", (route) => route.fulfill({ json: UPDATE_STATUS }));
  const stops: unknown[] = [];
  await page.route("**/api/update/stop", async (route) => {
    stops.push(route.request().postDataJSON());
    await route.fulfill({ json: { stopping: true } });
  });
  const requests = recordRequests(page);

  await page.goto("/");
  await expect(updateNotice(page)).toBeVisible();

  // Cancel is a way out, not a decision: the modal closes and Kana keeps
  // running. The round-trip first, so a wrongly-fired stop cannot hide.
  await copyInstallCommand(page);
  const dialog = updateDialog(page);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(updateNotice(page)).toBeVisible();
  await settleNetwork(page, "/api/update");
  expect(stopRequests(requests)).toEqual([]);
  expect(stops).toEqual([]);

  // Escape is the other way out, and stops nothing either.
  await copiedCommandButton(page).click();
  await expect(updateDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await settleNetwork(page, "/api/update");
  expect(stopRequests(requests)).toEqual([]);
  expect(stops).toEqual([]);
});

test("does not offer stopping Kana when the command could not be copied", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/update", (route) => route.fulfill({ json: UPDATE_STATUS }));
  const stops: unknown[] = [];
  await page.route("**/api/update/stop", async (route) => {
    stops.push(route.request().postDataJSON());
    await route.fulfill({ json: { stopping: true } });
  });
  const requests = recordRequests(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new Error("clipboard blocked")),
    });
  });

  await page.goto("/");
  const notice = updateNotice(page);
  await expect(notice).toBeVisible();
  await copyCommandButton(page).click();
  // The round-trip lets the rejected write settle before the assertions.
  await settleNetwork(page, "/api/update");

  // Nothing may claim the copy happened, no modal may open, and stopping may
  // not be offered: Kana must never stop before the user holds the command.
  await expect(notice.getByText("Command Copied", { exact: true })).toHaveCount(0);
  await expect(copyCommandButton(page)).toHaveText("Copy Command");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(shutdownButton(page)).toHaveCount(0);
  await expect(page.getByText(/could not be copied/)).toHaveCount(1);
  await expect(page.getByText(/could not be copied/)).toBeVisible();
  expect(stopRequests(requests)).toEqual([]);
  expect(stops).toEqual([]);

  // The command is still reachable: shown in a `<code>` the user selects and
  // copies by hand. That is the whole fallback, and it never runs npm.
  const shown = notice.locator("code");
  await expect(shown).toHaveText("npm i -g kana-alya@latest");
  const selectable = await shown.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? "";
  });
  expect(selectable).toBe("npm i -g kana-alya@latest");
  expectNoInstallRequest(requests);
});

test("adjusts the active avatar from the workspace instead of settings", async ({
  page,
}) => {
  // The panel waits for the phone chat fade, and that overlap only shows up
  // while transitions run.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const trigger = page.getByRole("button", {
    name: "Adjust avatar position and size",
  });
  await trigger.click();

  const panel = page.getByRole("region", {
    name: "Adjust avatar position and size",
  });
  await expect(panel).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    // The panel takes the composer's place, so the chat is completely gone
    // before the panel paints: never a half-faded chat under a half-faded
    // panel for a few frames.
    await expect(page.locator(".kana-chat-dock")).toHaveCSS("visibility", "hidden");
  }
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

test("never leaves a tapped header tab looking open on a touch device", async ({
  page,
}) => {
  // A touch browser keeps :hover on the last thing tapped until something else
  // is tapped, so an unguarded :hover rule leaves the closed tab showing its
  // white disc, its 2px lift, and its label bubble as if the panel were open.
  const trigger = page.getByRole("button", {
    name: "Adjust avatar position and size",
  });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  const hoverCapable = await page.evaluate(
    () => window.matchMedia("(hover: hover)").matches,
  );
  // mobile-chrome is a phone (390 px, no hover); desktop-chrome keeps its mouse.
  expect(hoverCapable).toBe((page.viewportSize()?.width ?? 0) >= 1024);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "button[aria-controls='kana-avatar-layout-panel']",
  });

  // Hold :hover on the closed tab, exactly as a phone does after a tap.
  await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] });
  if (hoverCapable) {
    await expect(trigger.locator(".kana-tip")).toBeVisible();
    await expect(trigger).not.toHaveCSS("transform", "none");
  } else {
    await expect(trigger.locator(".kana-tip")).toBeHidden();
    await expect(trigger).toHaveCSS("transform", "none");
    await expect(trigger).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
  await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
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

test("composer grows upward, shrinks back, and phone Enter only adds a line", async ({ page }) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  const height = async () => (await composer.boundingBox())?.height ?? 0;

  await composer.fill("First line");
  const oneLine = await height();

  await composer.press("Shift+Enter");
  await composer.type("Second line");
  await expect.poll(height).toBeGreaterThan(oneLine);
  const twoLines = await height();

  await composer.press("Enter");
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    // Enter belongs to the phone keyboard: the draft keeps its new line until
    // the reader taps Send.
    await expect(composer).toHaveValue("First line\nSecond line\n");
    await page.getByRole("button", { name: "Send", exact: true }).click();
  }
  await expect(composer).toHaveValue("");
  await expect(composer).toBeEditable();

  await composer.fill("Short");
  await expect.poll(height).toBeLessThan(twoLines);
  expect(await height()).toBeLessThanOrEqual(oneLine + 1);
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
  await expect(trigger).toHaveText(/^deepseek-v4$/);
  // The chip carries the model glyph and a real chevron, never a typed "⌄".
  await expect(trigger.locator("svg")).toHaveCount(2);
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
  await submitDraft(page, composer);
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

test("arms the approval before Enter can run, and Deny stays immediately available", async ({
  page,
}) => {
  const raise = () =>
    page.evaluate(() => {
      const target = window as Window & { __kanaE2eEmit?: (event: string, data: unknown) => void };
      target.__kanaE2eEmit?.("hermes", {
        jsonrpc: "2.0",
        method: "event",
        params: {
          type: "approval.request",
          payload: {
            command: "rm -rf /tmp/build",
            description: "Delete a build directory",
            choices: ["once", "deny"],
            allow_permanent: false,
          },
        },
      });
    });

  await raise();
  const heading = page.getByRole("heading", { name: "Hermes needs approval" });
  await expect(heading).toBeVisible();

  // The approving action is held down at first: an Enter that arrives with the
  // dialog (the user was typing) must not run the command. Deny never waits.
  await expect(page.getByRole("button", { name: "Run once" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Deny" })).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect(heading).toBeVisible();

  // Once armed, Enter runs the command the same key would run in a terminal.
  await expect(page.getByRole("button", { name: "Run once" })).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect(heading).toBeHidden();
});

/**
 * A fresh signed-in context whose relay and runtime answer before its first
 * page. A second page in the fixture's context raced the first fetches and
 * left them paused forever.
 */
async function openGatePage(
  browser: Browser,
  page: Page,
  options: {
    runtime: "running" | "stopped" | "external-unreadable";
    connectOnFirstAttempt: boolean;
    runtimeDelayMs?: number;
  },
): Promise<{ context: BrowserContext; gatePage: Page }> {
  const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } =
    test.info().project.use;
  const context = await browser.newContext({
    baseURL,
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    serviceWorkers: "block",
    storageState: { cookies: await page.context().cookies(), origins: [] },
  });
  const runtime = {
    controlAvailable: true,
    state: options.runtime === "stopped" ? "stopped" : "running",
    managed: false,
    executable: "/usr/bin/hermes",
    port: 9119,
    websocketUrl: "ws://127.0.0.1:9119/api/ws",
    tokenAvailable: options.runtime === "running",
    message: "Hermes gateway detected.",
  };
  await context.route("**/api/kana/sessions", (route) =>
    route.fulfill({ json: { sessions: [] } }),
  );
  await context.route("**/api/hermes/rpc", (route) =>
    route.fulfill({ status: 502, json: { error: "Hermes is not running." } }),
  );
  await context.route("**/api/local-runtime/hermes*", async (route) => {
    if (options.runtimeDelayMs) await new Promise((resolve) => setTimeout(resolve, options.runtimeDelayMs));
    await route.fulfill({ json: runtime });
  });
  const gatePage = await context.newPage();
  await gatePage.route(/cubism\.live2d\.com|model\.res\.live2d\.com/, (route) =>
    route.abort(),
  );
  await gatePage.addInitScript((connectOnFirstAttempt: boolean) => {
    localStorage.setItem(
      "kana.preferences.v3",
      JSON.stringify({
        uiLocale: "en",
        subtitleLanguage: "en",
        agentMode: "hermes",
        voiceEnabled: false,
        voiceMode: "configured",
        avatarMode: "live2d",
      }),
    );
    type GateWindow = Window & {
      __kanaGateAllowConnect?: boolean;
      __kanaGateDrop?: () => void;
    };
    const target = window as GateWindow;
    target.__kanaGateAllowConnect = connectOnFirstAttempt;

    // The relay stream answers unreachable until the test opens it, so the
    // waiting and connected states can be observed.
    class GateEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url = "/api/hermes/events";
      readonly withCredentials = true;
      readyState = GateEventSource.CONNECTING;

      constructor() {
        super();
        target.__kanaGateDrop = () => this.dispatchEvent(new Event("error"));
        queueMicrotask(() => {
          this.readyState = GateEventSource.OPEN;
          this.dispatchEvent(new Event("open"));
          const deliver = () => {
            this.dispatchEvent(
              new MessageEvent("gateway", {
                data: JSON.stringify({ connected: Boolean(target.__kanaGateAllowConnect) }),
              }),
            );
          };
          // Keep the attempt pending long enough to observe the gate it owns.
          setTimeout(deliver, target.__kanaGateAllowConnect ? 700 : 400);
        });
      }

      close(): void {
        this.readyState = GateEventSource.CLOSED;
      }
    }

    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: GateEventSource,
    });
  }, options.connectOnFirstAttempt);
  return { context, gatePage };
}

test("plays the seating animation for the automatic connection", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const { context, gatePage } = await openGatePage(browser, page, {
    runtime: "running",
    connectOnFirstAttempt: true,
  });
  await gatePage.goto("/");
  const screen = gatePage.getByRole("region", { name: "Hermes connection" });
  // The automatic attempt shows the gate while the relay connects.
  await expect(screen.locator(".kana-connection-stage")).toHaveClass(/is-trying/);
  await expect(screen.getByRole("heading", { name: "Reconnecting" })).toBeVisible();
  // Connected is not the end: the cable seats, the workspace stays down until
  // the seating animation has played.
  await expect(screen.getByRole("heading", { name: "Connected to Hermes" })).toBeVisible();
  await expect(screen.locator(".kana-connection-canvas")).toBeVisible();
  await expect(gatePage.getByRole("textbox", { name: "Message Kana" })).toHaveCount(0);
  await expect(screen).toBeHidden({ timeout: 5000 });
  await expect(gatePage.getByRole("textbox", { name: "Message Kana" })).toBeVisible();
  await context.close();
});

test("names an external Hermes whose session token Kana cannot read", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const { context, gatePage } = await openGatePage(browser, page, {
    runtime: "external-unreadable",
    connectOnFirstAttempt: false,
    runtimeDelayMs: 800,
  });
  await gatePage.goto("/");
  const screen = gatePage.getByRole("region", { name: "Hermes connection" });
  await expect(screen).toBeVisible();
  const art = screen.locator(".kana-connection-art");
  const gateHeading = screen.getByRole("heading");
  const before = { art: await art.boundingBox(), heading: await gateHeading.boundingBox() };
  // A visible gateway with no readable token is its own outcome, not a plain
  // connection failure: the heading says what happened and what to do.
  await expect(
    screen.getByRole("heading", { name: "Session token unavailable" }),
  ).toBeVisible();
  // The explanation arrives after the runtime check; the art and the heading
  // must stay where they were instead of re-centering with the new text.
  const after = { art: await art.boundingBox(), heading: await gateHeading.boundingBox() };
  expect(before.art).not.toBeNull();
  expect(after.art).not.toBeNull();
  expect(before.heading).not.toBeNull();
  expect(after.heading).not.toBeNull();
  expect(Math.abs(after.art!.y - before.art!.y)).toBeLessThan(1);
  expect(Math.abs(after.heading!.y - before.heading!.y)).toBeLessThan(1);
  await expect(screen.getByRole("status")).toHaveCount(0);
  await expect(screen.getByText(/found a Hermes gateway on port 9119/)).toBeVisible();
  await expect(screen.getByText(/Ctrl\+C/)).toBeVisible();
  await expect(screen.getByText("Connection failed", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", { name: "Connect again" })).toBeEnabled();
  await gatePage.screenshot({
    path: `test-results/connection-external-token-${test.info().project.name}.png`,
  });
  await context.close();
});

test("stands the workspace down while Hermes is unreachable and plugs in on connect", async ({
  page,
  browser,
}) => {
  // This journey spends real time in each connection phase, including the
  // first automatic attempt, so the default timeout is not enough.
  test.setTimeout(90_000);
  const { context, gatePage } = await openGatePage(browser, page, {
    runtime: "stopped",
    connectOnFirstAttempt: false,
  });
  await gatePage.goto("/");
  const screen = gatePage.getByRole("region", { name: "Hermes connection" });
  // The first automatic attempt belongs to the gate too: the workspace and its
  // composer must never show while the relay is still connecting.
  await expect(screen).toBeVisible();
  await expect(screen.locator(".kana-connection-stage")).toHaveClass(/is-trying/);
  await expect(screen.getByRole("heading", { name: "Reconnecting" })).toBeVisible();
  // Scope to the app: the Next.js dev overlay has its own empty alert region.
  await expect(gatePage.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(screen.getByRole("heading", { name: "Connection failed" })).toHaveClass(/text-danger/);
  await expect(
    screen.getByRole("img", { name: "Hermes cable and plug disconnected" }),
  ).toBeVisible();
  await expect(screen.getByRole("status")).toHaveCount(0);
  await expect(screen.getByRole("button", { name: "Connect Hermes" })).toBeEnabled();

  // The header stays available; the avatar and the chat step away.
  await expect(gatePage.getByRole("button", { name: "Open settings" })).toBeVisible();
  await expect(gatePage.getByRole("button", { name: "Open conversation history" })).toBeVisible();
  await expect(gatePage.getByRole("button", { name: /^Switch to (light|dark) theme$/ })).toBeVisible();
  await expect(gatePage.getByRole("button", { name: "Adjust avatar position and size" })).toHaveCount(0);
  await expect(gatePage.getByRole("textbox", { name: "Message Kana" })).toHaveCount(0);
  await gatePage.screenshot({
    path: `test-results/connection-screen-${test.info().project.name}.png`,
  });

  // The plug waits through the connecting phase, seats when the relay reports
  // connected, then the workspace returns.
  await gatePage.evaluate(() => {
    (window as Window & { __kanaGateAllowConnect?: boolean }).__kanaGateAllowConnect = true;
  });
  await screen.getByRole("button", { name: "Connect Hermes" }).click();
  await expect(screen.locator(".kana-connection-stage")).toHaveClass(/is-trying/);
  await expect(screen.getByRole("heading", { name: "Reconnecting" })).toBeVisible();
  await expect(screen.getByRole("button", { name: "Connecting…" })).toBeDisabled();
  await gatePage.waitForTimeout(250);
  await gatePage.screenshot({
    path: `test-results/connection-plugging-${test.info().project.name}.png`,
  });
  await expect(screen.getByRole("img", { name: "Hermes cable and plug connected" })).toBeVisible();
  await expect(screen.getByRole("heading", { name: "Connected to Hermes" })).toBeVisible();
  await gatePage.screenshot({
    path: `test-results/connection-plugged-${test.info().project.name}.png`,
  });
  await expect(screen).toBeHidden({ timeout: 3000 });
  await expect(gatePage.getByRole("textbox", { name: "Message Kana" })).toBeVisible();

  // A live drop leaves Hermes unreachable while Kana retries, so the cable
  // screen returns and the workspace stands down for the whole outage.
  await gatePage.evaluate(() => {
    const target = window as Window & {
      __kanaGateAllowConnect?: boolean;
      __kanaGateDrop?: () => void;
    };
    target.__kanaGateAllowConnect = false;
    target.__kanaGateDrop?.();
  });
  await expect(screen).toBeVisible();
  // The heading is the only status label, and it turns red only when the gate
  // is waiting without an attempt in flight.
  await expect(screen.getByRole("heading", { name: "Hermes is not connected" })).toHaveClass(/text-danger/);
  await expect(screen.getByRole("status")).toHaveCount(0);
  await expect(screen.getByText("Reconnecting…", { exact: true })).toHaveCount(0);
  // The retry loop must not trap the user: the button stays usable so a manual
  // attempt can start a Hermes that died.
  await expect(screen.getByRole("button", { name: "Connect Hermes" })).toBeEnabled();
  await expect(gatePage.getByRole("textbox", { name: "Message Kana" })).toHaveCount(0);
  await gatePage.screenshot({
    path: `test-results/connection-reconnecting-${test.info().project.name}.png`,
  });
  await context.close();
});

test("shows the sudo prompt in the shared dialog shell and sends the password once", async ({
  page,
}) => {
  await page.evaluate(() => {
    const target = window as Window & { __kanaE2eEmit?: (event: string, data: unknown) => void };
    target.__kanaE2eEmit?.("hermes", {
      jsonrpc: "2.0",
      method: "event",
      params: {
        type: "sudo.request",
        payload: { request_id: "sudo-e2e-1" },
      },
    });
  });

  const dialog = page.getByRole("dialog", { name: "Sudo password required" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Hermes needs a password for the current protected command."),
  ).toBeVisible();
  const password = dialog.getByLabel(/^Password/);
  await expect(password).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  await page.screenshot({ path: `test-results/sudo-${test.info().project.name}.png` });

  await password.fill("e2e-sudo-password");
  await dialog.getByRole("button", { name: "Send securely" }).click();
  await expect(dialog).toBeHidden();
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

test("shows every background card whole and keeps an uploaded image locally", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", {
    name: /^Avatar(?: Avatar and stage)?$/,
  }).click();

  const backgrounds = page.getByRole("radiogroup", { name: "Stage background" });
  const layout = await backgrounds.evaluate((grid) => {
    const bounds = grid.getBoundingClientRect();
    const cards = [...grid.children].map((card) => card.getBoundingClientRect());
    return {
      inside: cards.every((card) => card.left >= bounds.left - 0.5 && card.right <= bounds.right + 0.5),
      widths: new Set(cards.map((card) => Math.round(card.width))).size,
      columns: new Set(cards.map((card) => Math.round(card.left))).size,
      last: grid.lastElementChild?.textContent,
    };
  });
  // A wrapping wardrobe grid: nothing clipped or scrolled away, one card width.
  expect(layout.inside).toBe(true);
  expect(layout.widths).toBe(1);
  if ((page.viewportSize()?.width ?? 0) < 640) expect(layout.columns).toBe(2);
  else expect(layout.columns).toBeGreaterThanOrEqual(3);
  expect(layout.last).toBe("Upload image");

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
  await submitDraft(page, composer);
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

test("sends the nearest command Hermes offered when Enter runs an unknown one", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.click();
  await composer.fill("/codex-run");
  // Hermes's own completer offers /codex-runtime for the /codex-run prefix.
  await page.getByRole("option", { name: /\/codex-runtime/ }).first().waitFor();
  await submitDraft(page, composer);
  await expect.poll(() => hermes.commands).toContain("codex-runtime");
  expect(hermes.commands).not.toContain("codex-run");
  // The chat shows the command that actually ran, not what was typed. Phones
  // have no live chat panel, so this reads the restored transcript instead.
  await openHistory(page);
  await expect(
    page.getByText("/codex-runtime", { exact: true }).last(),
  ).toBeVisible();
});

test("never rewrites a command that is already real", async ({ page }) => {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.click();
  await composer.fill("/new Deal with the report");
  await page.getByRole("option", { name: /\/new/ }).first().waitFor();
  await submitDraft(page, composer);
  // Kana answers /new itself, so it never reaches Hermes as a slash command:
  // a name that is already real is still not rewritten.
  await expect.poll(() => hermes.commands).not.toContain("new");
  expect(hermes.commands).not.toContain("codex-runtime");
  await expect(page.getByText("Deal with the report").first()).toBeVisible();
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

test("turns the workspace into a chat-only view for a focused conversation", async ({
  page,
}) => {
  const stage = page.getByRole("region", { name: "Kana avatar stage" });
  const avatarLayer = page.locator(".kana-avatar-viewport");
  const dock = page.locator(".kana-chat-dock");
  const rail = page.locator(".kana-focus-rail");
  const canvas = page.getByTestId("live2d-canvas");
  const scale = page.getByRole("button", { name: "Adjust avatar position and size" });
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await expect(stage).toBeVisible();
  await expect(avatarLayer).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Avatar(?: Avatar and stage)?$/ }).click();
  await dialog.getByRole("switch", { name: "Show avatar" }).click();
  await dialog.getByRole("button", { name: "Close settings" }).click();

  // The avatar is gone, the room is still there, and desktop becomes a rail
  // plus a readable column instead of one card in an empty workspace.
  await expect(avatarLayer).toBeHidden();
  await expect(stage).toBeVisible();
  await expect(scale).toHaveCount(0);
  await expect(dock).toHaveClass(/is-sole/);
  const viewportSize = page.viewportSize();
  const viewport = viewportSize?.width ?? 0;
  const viewportHeight = viewportSize?.height ?? 0;

  if (viewport >= 1024) {
    await expect(rail).toBeVisible();
    const railBox = await rail.boundingBox();
    expect(railBox?.x ?? 0).toBeGreaterThanOrEqual(15);
    expect(railBox?.x ?? 0).toBeLessThanOrEqual(17);
    expect(Math.round(railBox?.y ?? 0)).toBe(84);
    expect(railBox?.width ?? 0).toBeGreaterThanOrEqual(264);
    expect(railBox?.width ?? 0).toBeLessThanOrEqual(288);
    expect(
      Math.abs((railBox?.y ?? 0) + (railBox?.height ?? 0) - (viewportHeight - 16)),
    ).toBeLessThan(2);

    // The panel fills the space right of the rail, edge to edge, while the
    // conversation inside it keeps its narrow measure.
    await expect
      .poll(async () => {
        const box = await dock.boundingBox();
        if (!box || !railBox) return Number.NaN;
        return Math.abs(
          box.x - (railBox.x + railBox.width + 16),
        );
      })
      .toBeLessThan(2);
    const solo = await dock.boundingBox();
    expect(solo?.width ?? 0).toBeGreaterThan(viewport * 0.7);
    expect(Math.round((solo?.x ?? 0) + (solo?.width ?? 0))).toBe(viewport - 16);
  } else {
    // Phones keep their full-bleed chat and never mount the rail.
    await expect(rail).toHaveCount(0);
    const solo = await dock.boundingBox();
    expect(solo?.width ?? 0).toBeGreaterThanOrEqual(viewport - 2);
  }
  expect((await dock.boundingBox())?.width ?? 0).toBeLessThanOrEqual(viewport);

  // The canvas stays mounted, so the model and its WebGL context survive.
  await expect(canvas).toHaveCount(1);
  await expect(composer).toBeVisible();

  if (viewport >= 1024) {
    // The rail is a working surface: creating a conversation never opens the
    // modal, and focus lands back in the composer.
    const conversations = page.getByRole("complementary", { name: "Conversations" });
    await expect(conversations).toBeVisible();
    await conversations.locator("button.kana-pill-accent").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(composer).toBeFocused();
  }

  // It survives a reload, because the choice is a local preference.
  await page.reload();
  await expect(avatarLayer).toBeHidden();
  if (viewport >= 1024) {
    await expect(rail).toBeVisible();
    await rail.getByRole("button", { name: "Show avatar" }).click();
  } else {
    await page.getByRole("button", { name: "Open settings" }).click();
    await dialog.getByRole("button", { name: /^Avatar(?: Avatar and stage)?$/ }).click();
    await dialog.getByRole("switch", { name: "Show avatar" }).click();
    await dialog.getByRole("button", { name: "Close settings" }).click();
  }
  await expect(stage).toBeVisible();
  await expect(avatarLayer).toBeVisible();
  await expect(scale).toBeVisible();
  await expect(rail).toHaveCount(0);
  await page.screenshot({ path: `test-results/chat-only-restored-${test.info().project.name}.png` });
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
  await submitDraft(page, composer);
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

function testToneWav(seconds = 1): Buffer {
  const samples = 16000 * seconds;
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
    await composer.fill("Please speak after the audio is ready"); await submitDraft(page, composer);
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
  await expect(engine.getByText("Model", { exact: true })).toBeVisible();
  await expect(engine.getByText("Irodori-TTS v4.1 Anime", { exact: true })).toBeVisible();
  await expect(engine.getByText("Download", { exact: true })).toBeVisible();
  await expect(engine.getByText("3.3 GB", { exact: true })).toBeVisible();
  await expect(engine.getByText("Disk", { exact: true })).toBeVisible();
  await expect(engine.getByText(/needed · .* free/)).toBeVisible();
  expect(actions).toEqual([]);
  // The toggle and the facts stay beside their labels at phone width too.
  const voiceLabel = await dialog.getByText("Kana's voice", { exact: true }).boundingBox();
  const voiceToggle = await dialog.getByRole("switch", { name: "Japanese voice" }).boundingBox();
  expect(voiceToggle!.x).toBeGreaterThan(voiceLabel!.x + voiceLabel!.width);
  const diskLabel = await engine.getByText("Disk", { exact: true }).boundingBox();
  const diskValue = await engine.getByText(/needed · .* free/).boundingBox();
  expect(diskValue!.x).toBeGreaterThan(diskLabel!.x + diskLabel!.width);
  await page.screenshot({ path: `test-results/engine-${test.info().project.name}.png` });

  await engine.getByRole("button", { name: "Download voice engine" }).click();
  await expect(engine.getByRole("progressbar")).toBeVisible();
  await expect(engine.getByText(/Downloading model · 50%/)).toBeVisible();
  await expect(engine.getByText("Installed")).toBeVisible({ timeout: 10_000 });
  await expect(engine.getByText("Download", { exact: true })).toHaveCount(0);
  await expect(engine.getByText("Device", { exact: true })).toBeVisible();
  await expect(engine.getByText("CPU int8 (AVX-512 VNNI)", { exact: true })).toBeVisible();
  expect(actions).toEqual(["install"]);
});

test("Settings → Voice shows voice cards and confirms before removing one", async ({ page }) => {
  let voices = [
    { id: "kc-default", name: "Kana", kind: "bundled", isDefault: true },
    { id: "e2e-reference", name: "Studio reference", kind: "reference", isDefault: false },
    { id: "irodori-model", name: "Irodori", kind: "model", isDefault: false },
  ];
  const deletes: string[] = [];
  const previews: Array<{ id?: string }> = [];
  let rejectPreview = false;
  await page.route("**/api/voice/tts/engine", (route) => route.fulfill({
    json: {
      provider: { id: "irodori-local", type: "irodori-local", name: "Irodori TTS", configured: true, model: "Irodori-TTS v4.1 Anime", capabilities: { instruction: false, localInstall: true, upstreamCancellation: true, voiceLibrary: true } },
      install: {
        state: "not_installed",
        engineInstalled: false,
        modelInstalled: false,
        modelSource: null,
        step: null,
        phase: null,
        completedBytes: 0,
        totalBytes: 0,
        downloadBytes: 3_544_900_182,
        requiredDiskBytes: 4_331_065_517,
        freeDiskBytes: 50_000_000_000,
        partialDownloadBytes: 0,
        int8: true,
        message: "",
      },
    },
  }));
  await page.route("**/api/kana/voices**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/kana/voices/preview") {
      previews.push(route.request().postDataJSON());
      if (rejectPreview) {
        return route.fulfill({ status: 503, json: { error: "Preview unavailable" } });
      }
      return route.fulfill({ contentType: "audio/wav", body: testToneWav(5) });
    }
    if (route.request().method() === "DELETE") {
      const id = url.searchParams.get("id") ?? "";
      deletes.push(id);
      voices = voices.filter((voice) => voice.id !== id);
      return route.fulfill({ json: { removed: true } });
    }
    return route.fulfill({
      json: {
        voices,
        supportsVoiceLibrary: true,
        provider: { id: "irodori-local", type: "irodori-local", name: "Irodori TTS", configured: true },
        providerStatus: { state: "ready", voices: [], message: "" },
      },
    });
  });
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Voice/ }).click();
  await dialog.getByRole("switch", { name: "Japanese voice" }).check();

  const library = dialog.getByRole("radiogroup", { name: "Choose Kana's voice" });
  await expect(library.getByRole("radio", { name: "Kana" })).toBeVisible();
  await expect(library.getByRole("radio", { name: "Studio reference" })).toBeVisible();
  await expect(library.getByRole("radio", { name: "Irodori" })).toBeVisible();
  await expect(library.getByRole("button", { name: "Add sample" })).toBeVisible();

  const kanaCard = library
    .locator(".kana-wardrobe-card")
    .filter({ has: page.getByRole("radio", { name: "Kana", exact: true }) });
  const kanaPreview = kanaCard.locator(".kana-voice-preview");
  await expect(kanaPreview).toHaveAccessibleName("Preview the voice “Kana”");
  if (test.info().project.name === "desktop-chrome") {
    await kanaPreview.hover();
    await expect(kanaPreview.locator(".kana-voice-preview-play")).toHaveCSS("opacity", "1");
  }
  await kanaPreview.click();
  await expect(kanaPreview).toHaveAccessibleName("Stop the preview of “Kana”");
  await expect(kanaPreview).toHaveAttribute("aria-pressed", "true");
  await expect(kanaPreview.locator(".kana-voice-preview-play")).toHaveCSS("opacity", "0");
  await expect
    .poll(async () => kanaPreview.locator("rect").first().evaluate((node) => getComputedStyle(node).animationName))
    .toBe("kana-voice-wave-bar");
  expect(previews).toEqual([{ id: "kc-default" }]);
  await kanaPreview.click();
  await expect(kanaPreview).toHaveAttribute("aria-pressed", "false");
  await expect(kanaPreview).toHaveAccessibleName("Preview the voice “Kana”");
  await expect
    .poll(async () => kanaPreview.locator("rect").first().evaluate((node) => getComputedStyle(node).animationName))
    .toBe("none");

  rejectPreview = true;
  await kanaPreview.click();
  await expect(dialog.getByText("Preview unavailable")).toBeVisible();
  await expect(kanaPreview).toHaveAttribute("aria-pressed", "false");

  await library
    .getByRole("radio", { name: "Studio reference" })
    .click({ position: { x: 12, y: 12 } });
  await expect(library.getByRole("radio", { name: "Studio reference" }))
    .toHaveAttribute("aria-checked", "true");

  await library.getByRole("button", { name: "Remove voice “Studio reference”" }).click();
  await expect(library.getByRole("button", { name: "Remove voice “Studio reference”?" })).toBeVisible();
  expect(deletes).toEqual([]);
  await page.screenshot({ path: `test-results/voice-${test.info().project.name}.png` });
  await library.getByRole("button", { name: "Remove voice “Studio reference”?" }).click();
  await expect(library.getByRole("radio", { name: "Studio reference" })).toHaveCount(0);
  expect(deletes).toEqual(["e2e-reference"]);
});

test("TTS failure reveals held text with an explicit voice error", async ({ page }) => {
  await enableTestVoice(page);
  await page.route("**/api/voice/tts/speech", (route) => route.fulfill({ status: 503, json: { error: "Test voice unavailable" } }));
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill("Handle an unavailable voice"); await submitDraft(page, composer);
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
  await composer.fill("First greeting"); await submitDraft(page, composer);
  await expect(page.getByText("Hello! I am here.", { exact: true })).toHaveCount(1);
  await composer.fill("Say that again"); await submitDraft(page, composer);
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
  await composer.fill("Stop this pending voice"); await submitDraft(page, composer);
  await expect.poll(() => requested).toBe(true);
  await expect(page.getByText("Hello! I am here.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByText("Hello! I am here.", { exact: true }).first()).toBeVisible();
  await expect.poll(() => cancelled).toBe(true);
});

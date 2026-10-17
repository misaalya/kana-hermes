import { devices, expect, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_HARU_BINDINGS,
  OFFICIAL_CUBISM_CORE_URL,
  OFFICIAL_HARU_MODEL_URL,
} from "../../lib/avatar/defaults";
import { E2E_ACCESS_PASSWORD } from "../e2e/access-password";

/**
 * The machinery `readme-screenshots.spec.ts` drives.
 *
 * The conversation is a stand-in Hermes in the browser, the same approach the
 * acceptance journeys use, so a capture is deterministic instead of depending
 * on a live model and a real session. Everything else is the product: the real
 * server, the real Live2D samples from Live2D's pinned repository, and the real
 * preferences a reader would have. A prompt travels the real path — the
 * composer, the contract note in the user turn, and a `message.complete` event
 * coming back through the relay — so what is photographed is what a reader gets.
 */

export const README_DIR = path.join(process.cwd(), ".github", "readme");
/** Width one phone screenshot is scaled to inside the pair. */
const PHONE_WIDTH = 500;

const RUNTIME_ID = "readme-hermes-runtime-1";

/** What the first exchange asks for and what Hermes answers with. */
const FIRST_PROMPT = "catch me up on today's science news";
const FIRST_REPLY = [
  "Here is the **science roundup** for today:",
  "",
  "- **Mars** — NASA's Perseverance rover broke the record for off-planet driving, and it is still going.",
  "- **Black holes** — jets from black holes of very different sizes follow one universal rule.",
  "- **Archaeology** — divers explored a Bronze Age shipwreck off the coast of Türkiye.",
  "",
  "Sources: Reuters, ScienceDaily, and Scientific American.",
].join("\n");

const SECOND_PROMPT = "tell me more about the Perseverance record";
const SECOND_REPLY = [
  "Perseverance has now driven farther than any rover off Earth — the record had belonged to **Opportunity** since 2019.",
  "",
  "It is still exploring the rim of Jezero crater, picking its own safe path through the rough terrain.",
].join("\n");

/** Answers handed out in order, one per submitted prompt. */
const REPLY_QUEUE = [
  { emotion: "neutral", body: FIRST_REPLY },
  { emotion: "happy", body: SECOND_REPLY },
];

/**
 * Plain text at the end of each reply, which is what the rendered Markdown
 * still contains: an assertion target that does not depend on `**` or backticks.
 */
const FIRST_REPLY_MARKER = "Scientific American.";
const SECOND_REPLY_MARKER = "since 2019.";

const PREFERENCES = {
  onboardingCompleted: true,
  uiLocale: "en",
  agentMode: "hermes",
  voiceEnabled: false,
  voiceMode: "configured",
  avatarMode: "live2d",
  avatarVisible: true,
  stageBackground: "pattern-seigaiha",
  hermes: { cwd: "" },
  voice: { voiceId: "", deliveryMode: "complete" },
  live2d: {
    modelId: undefined,
    modelName: "Haru",
    modelUrl: OFFICIAL_HARU_MODEL_URL,
    coreScriptUrl: OFFICIAL_CUBISM_CORE_URL,
    mouthOpenParameter: DEFAULT_HARU_BINDINGS.mouthOpenParameter,
    bindingProfiles: {
      [`url:${OFFICIAL_HARU_MODEL_URL}`]: DEFAULT_HARU_BINDINGS,
    },
    hostedModels: [],
  },
};

/** Delivers one Hermes event over the relay the page is listening to. */
async function emitHermesEvent(
  page: Page,
  type: string,
  payload: Record<string, unknown>,
  runtimeId: string,
): Promise<void> {
  await page.evaluate(
    ({ eventType, eventPayload, eventRuntimeId }) => {
      const target = window as Window & {
        __kanaReadmeEmit?: (event: string, data: unknown) => void;
      };
      target.__kanaReadmeEmit?.("hermes", {
        jsonrpc: "2.0",
        method: "event",
        params: {
          type: eventType,
          session_id: eventRuntimeId,
          payload: eventPayload,
        },
      });
    },
    { eventType: type, eventPayload: payload, eventRuntimeId: runtimeId },
  );
}

/**
 * A browser-side Hermes: the event stream the relay would forward, an empty
 * session directory so the workspace starts fresh, and answers for the RPCs a
 * workspace load and a prompt call.
 */
async function installStandInHermes(page: Page): Promise<void> {
  /** One answer per prompt this page sends, in order. */
  const replies = [...REPLY_QUEUE];
  await page.addInitScript(() => {
    type ReadmeWindow = Window & {
      __kanaReadmeEmit?: (event: string, data: unknown) => void;
    };
    const target = window as ReadmeWindow;
    const sources: EventTarget[] = [];

    class StandInEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = true;
      readyState = StandInEventSource.CONNECTING;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        sources.push(this);
        queueMicrotask(() => {
          this.readyState = StandInEventSource.OPEN;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("gateway", {
              data: JSON.stringify({ connected: true }),
            }),
          );
        });
      }

      close(): void {
        this.readyState = StandInEventSource.CLOSED;
      }
    }

    target.__kanaReadmeEmit = (event, data) => {
      for (const source of sources) {
        source.dispatchEvent(
          new MessageEvent(event, { data: JSON.stringify(data) }),
        );
      }
    };
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: StandInEventSource,
    });
  });

  // A reader with no stored conversation anywhere: the workspace opens fresh.
  await page.route("**/api/kana/sessions", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ sessions: [] }),
    }),
  );
  await page.route("**/api/local-runtime/hermes**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        controlAvailable: true,
        state: "running",
        managed: false,
        executable: "/usr/local/bin/hermes",
        port: 9119,
        websocketUrl: "ws://127.0.0.1:9119/api/ws",
        message: "Hermes is running.",
      }),
    }),
  );
  await page.route("**/api/voice/tts/engine", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        provider: {
          id: "irodori-local",
          type: "irodori-local",
          name: "Irodori TTS",
          configured: true,
          model: "Irodori-TTS v4.1 Anime",
          capabilities: {
            instruction: false,
            localInstall: true,
            upstreamCancellation: true,
            voiceLibrary: true,
          },
        },
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
          message: "The local voice engine has not been downloaded yet.",
        },
      }),
    }),
  );
  await page.route("**/api/hermes/rpc", async (route) => {
    const body = route.request().postDataJSON() as {
      method?: string;
      params?: Record<string, unknown>;
    };
    let result: unknown = {};
    switch (body.method) {
      case "session.create":
        result = { session_id: RUNTIME_ID, stored_session_id: RUNTIME_ID };
        break;
      case "session.resume":
        // A pointer from an earlier browser: resume it with no transcript, so
        // the capture starts from the same empty conversation every time.
        result = {
          session_id: RUNTIME_ID,
          session_key: RUNTIME_ID,
          resumed: RUNTIME_ID,
          running: false,
          messages: [],
        };
        break;
      case "session.title":
        result = { title: "" };
        break;
      case "session.status":
        result = { output: "Hermes is ready." };
        break;
      case "commands.catalog":
        result = {
          categories: [
            {
              name: "Session",
              pairs: [
                ["/status", "Show the current Hermes session status"],
                ["/reload", "Apply Hermes environment changes"],
                ["/restart", "Restart Hermes and resume this conversation"],
              ],
            },
          ],
        };
        break;
      case "complete.slash":
        // A live Hermes completes "/re" with its own controls: Kana keeps
        // /resume and /restart locally, so the stand-in answers with only the
        // commands Hermes itself describes.
        result = body.params?.text === "/re"
          ? {
              replace_from: 1,
              items: [
                { text: "/retry", meta: "Retry the last message (resend)" },
                { text: "/refine", meta: "Review this conversation now" },
                { text: "/reasoning", meta: "Manage reasoning effort and budget" },
                { text: "/reload", meta: "Reload .env variables into the gateway" },
              ],
            }
          : { replace_from: 1, items: [] };
        break;
      case "model.options":
        result = {
          provider: "deepseek",
          model: "deepseek/deepseek-v4.1-flash",
          providers: [
            {
              slug: "deepseek",
              name: "DeepSeek",
              models: ["deepseek/deepseek-v4.1-flash"],
              is_current: true,
              authenticated: true,
            },
          ],
        };
        break;
      case "slash.exec":
      case "command.dispatch":
        result = { type: "exec", output: "Done." };
        break;
      case "approval.respond":
        result = { resolved: true };
        break;
      case "prompt.submit": {
        const submitted = String(body.params?.text ?? "");
        const runtimeId = String(body.params?.session_id ?? RUNTIME_ID);
        // Stand-in for Hermes following the contract: the user's words, then
        // the Kana note asking for the header.
        const noteStart = submitted.lastIndexOf("\n\n<kana>\n");
        if (
          noteStart === -1 ||
          !/\n---\n(?:ja|emotion): /.test(submitted.slice(noteStart))
        ) {
          throw new Error("Kana sent no response contract in the user turn.");
        }
        const reply = replies.shift();
        if (!reply) {
          throw new Error(
            `No stand-in reply is queued for: ${submitted.slice(0, noteStart)}`,
          );
        }
        const speaks = /\n---\nja: /.test(submitted.slice(noteStart));
        const text = [
          "---",
          ...(speaks ? ["ja: \u3053\u3093\u306b\u3061\u306f\u3001\u3053\u3053\u306b\u3044\u307e\u3059\u3002"] : []),
          `emotion: ${reply.emotion}`,
          "lang: en",
          "---",
          reply.body,
        ].join("\n");
        result = { accepted: true };
        setTimeout(() => {
          void emitHermesEvent(
            page,
            "message.complete",
            { status: "complete", text },
            runtimeId,
          ).catch(() => undefined);
        }, 30);
        break;
      }
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ result }),
    });
  });
}

/**
 * Opens the workspace with the preferences a reader would have. The workspace
 * starts on a fresh conversation; `sendPrompt` fills it.
 */
export async function openWorkspace(
  page: Page,
  options: { theme?: "light" | "dark"; avatarVisible?: boolean } = {},
): Promise<void> {
  const { theme = "light", avatarVisible = true } = options;
  await page.addInitScript(
    ({ preferences, theme }) => {
      localStorage.setItem("kana.preferences.v5", JSON.stringify(preferences));
      localStorage.setItem("kana.theme", theme);
    },
    { preferences: { ...PREFERENCES, avatarVisible }, theme },
  );
  await page.request.post("/api/auth/login", {
    data: { password: E2E_ACCESS_PASSWORD },
  });
  // Skip the install wizard: this capture is of the established workspace.
  await page.request.put("/api/kana/setup");
  await installStandInHermes(page);
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Message Kana" }),
  ).toBeVisible();
}

/** Sends one prompt through the composer and waits for its reply to arrive. */
async function sendPrompt(
  page: Page,
  prompt: string,
  marker: string,
): Promise<void> {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.fill(prompt);
  await composer.press("Enter");
  // Hermes titles the session after the first words, so the prompt is both the
  // title and a bubble: only the feed matters here.
  const feed = page.getByRole("log", { name: "Live chat" });
  await expect(feed.getByText(prompt, { exact: true })).toBeVisible();
  await expect(feed.getByText(marker).first()).toBeVisible();
  // The reply is complete only once the feed stops showing it as typing.
  await expect(page.locator(".kana-typing")).toHaveCount(0);
}

/** Fills the feed with the two exchanges the README shows. */
export async function sendReadmeConversation(page: Page): Promise<void> {
  await sendPrompt(page, FIRST_PROMPT, FIRST_REPLY_MARKER);
  await sendPrompt(page, SECOND_PROMPT, SECOND_REPLY_MARKER);
}

/**
 * Proves the frame is worth taking before it is taken: both exchanges are on
 * screen with the reply's copy button painted, and the avatar has loaded.
 */
export async function expectWorkspaceReady(
  page: Page,
  options: { avatarVisible: boolean },
): Promise<void> {
  const feed = page.getByRole("log", { name: "Live chat" });
  await expect(feed.getByText(FIRST_REPLY_MARKER).first()).toBeVisible();
  await expect(feed.getByText(SECOND_REPLY_MARKER).first()).toBeVisible();
  const reply = page.locator("article", { hasText: FIRST_REPLY_MARKER });
  await expect(reply).toBeVisible();
  const copy = reply.getByRole("button", { name: "Copy message" });
  await expect(copy).toBeVisible();
  // A reply keeps its copy button in view without a pointer.
  expect(await copy.evaluate((node) => getComputedStyle(node).opacity)).toBe(
    "1",
  );

  const avatar = page.locator(".kana-avatar-viewport");
  if (options.avatarVisible) {
    await expect(page.getByTestId("live2d-canvas")).toBeVisible({
      timeout: 90_000,
    });
    // The canvas mounts before the model is decoded. The "Kana is getting
    // ready" fallback is what the stage shows until then, so the frame is
    // honest only once that message is gone for good.
    await expect(page.locator(".kana-stage-message")).toHaveCount(0, {
      timeout: 120_000,
    });
    await expect(avatar).toBeVisible();
  } else {
    await expect(avatar).toBeHidden();
    await expect(page.locator(".kana-chat-dock")).toHaveClass(/is-sole/);
  }
  // Two exchanges: a reader's bubble and a reply each.
  await expect(page.locator(".kana-chat-feed article")).toHaveCount(4);
  const title = (await page.locator(".kana-session-title").textContent())?.trim();
  process.stdout.write(`  [frame] conversation title: ${title}\n`);
  // Let the dock transition and the avatar's first idle motion settle.
  await page.waitForTimeout(1200);
}

/**
 * Types "/re" into the composer and waits for the live menu: Kana's /resume and
 * /restart groups plus Hermes controls, sourced from the stand-in's
 * `complete.slash` items, with the loading hint gone and no stale catalog rows.
 */
export async function openSlashMenu(page: Page): Promise<void> {
  const composer = page.getByRole("textbox", { name: "Message Kana" });
  await composer.click();
  await composer.fill("/");
  await composer.pressSequentially("re");
  const menu = page.locator("#kana-command-menu");
  await expect(menu).toBeVisible({ timeout: 20_000 });
  for (const command of ["/resume", "/restart", "/retry", "/refine", "/reasoning", "/reload"]) {
    await expect(menu.getByRole("option", { name: new RegExp(`^${command}`) })).toBeVisible();
  }
  for (const group of ["Kana & session", "Hermes controls", "Commands"]) {
    await expect(menu.getByText(group, { exact: true })).toBeVisible();
  }
  // The completion has settled and the plain "/" catalog is not on screen.
  await expect(menu.getByText("Finding actions…")).toHaveCount(0);
  await expect(menu.getByText("Session", { exact: true })).toHaveCount(0);
}

/**
 * Opens Settings on the Avatar pane in the state the README shows: the avatar
 * visible, Haru chosen on the Seigaiha stage, and a portrait in both cards. A
 * portrait is taken from the stage the first time an avatar is shown, so Mao
 * gets one visit before the frame is taken.
 */
export async function openAvatarSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: /^Avatar(?: Avatar and stage)?$/ })
    .click();
  const haru = dialog.getByRole("radio", { name: "Haru" });
  const mao = dialog.getByRole("radio", { name: "Mao" });
  await expect(haru).toBeVisible();
  // Mao has never been on the stage in this browser, so its card holds the
  // placeholder until the visit below takes its portrait.
  await mao.click();
  await expect(mao.locator("img")).toBeVisible({ timeout: 120_000 });
  await haru.click();
  await expect(haru.locator("img")).toBeVisible({ timeout: 120_000 });
  // The frame is honest only once it shows the state a reader gets.
  await expect(haru).toHaveAttribute("aria-checked", "true");
  await expect(
    dialog.getByRole("switch", { name: "Show avatar" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    dialog.getByRole("radio", { name: "Seigaiha" }),
  ).toHaveAttribute("aria-checked", "true");
  // Each click queues a preference save; a frame taken mid-save would show the
  // "Saving…" hint instead of the settled state a reader sees.
  await expect(dialog.getByText("Saved automatically")).toBeVisible({
    timeout: 30_000,
  });
  // The dialog's entrance animation settles before the frame is taken.
  await page.waitForTimeout(600);
}

/** Turns the avatar off exactly as Settings offers it. */
export async function hideAvatarFromSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: /^Avatar(?: Avatar and stage)?$/ })
    .click();
  await dialog.getByRole("switch", { name: "Show avatar" }).click();
  await dialog.getByRole("button", { name: "Close settings" }).click();
}

/** The options one phone context needs, from Playwright's device registry. */
export function phoneContextOptions(baseURL?: string) {
  return { ...devices["Pixel 5"], baseURL };
}

/** A desktop context at the size the README images are. */
export function desktopContextOptions(baseURL?: string) {
  return {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    baseURL,
  };
}

/**
 * Places two phone screenshots next to each other, the way the README shows
 * them, without an image tool: the browser composes the pair and photographs it.
 */
export async function composePhonePair(
  browser: Browser,
  images: string[],
  destination: string,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: PHONE_WIDTH * images.length, height: 600 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const sources = images.map(
    (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`,
  );
  await page.setContent(
    `<body style="margin:0"><div id="pair" style="display:flex;width:fit-content;height:fit-content">${sources
      .map(
        (source) =>
          `<img src="${source}" style="display:block;width:${PHONE_WIDTH}px">`,
      )
      .join("")}</div></body>`,
  );
  // setContent returns before the images decode; a screenshot then would be a
  // viewport-height strip of empty page. The pair hugs its own content, so the
  // element screenshot is the phones and nothing else.
  await page.waitForFunction(() =>
    Array.from(document.images).every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  await page.locator("#pair").screenshot({
    path: destination,
    type: "jpeg",
    quality: 82,
  });
  await context.close();
}
import { expect, test } from "@playwright/test";
import { E2E_ACCESS_PASSWORD } from "./access-password";

test("prepared voice previews play without the engine", async ({ page }) => {
  test.setTimeout(60_000);
  let synthesized = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/voice/tts/speech")) synthesized++;
  });
  await page.route(/cubism\.live2d\.com|model\.res\.live2d\.com/, (route) => route.abort());
  await page.route("**/api/hermes/rpc", (route) =>
    route.fulfill({ status: 502, json: { error: "Hermes is not running." } }),
  );
  await page.route("**/api/local-runtime/hermes*", (route) =>
    route.fulfill({
      json: {
        controlAvailable: true,
        state: "stopped",
        managed: false,
        executable: "/usr/bin/hermes",
        port: 9119,
        tokenAvailable: false,
        message: "Hermes is stopped.",
      },
    }),
  );
  await page.route("**/api/kana/sessions", (route) =>
    route.fulfill({ json: { sessions: [] } }),
  );
  await page.addInitScript(() => {
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
    class QuietEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url = "/api/hermes/events";
      readonly withCredentials = true;
      readyState = QuietEventSource.CLOSED;
      close(): void {}
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: QuietEventSource });

    type PreviewWindow = Window & { __previewDurations?: number[] };
    const target = window as PreviewWindow;
    target.__previewDurations = [];
    const nativeAudio = window.Audio;
    window.Audio = function (src?: string) {
      const audio = new nativeAudio(src);
      audio.addEventListener("loadedmetadata", () => {
        target.__previewDurations?.push(audio.duration);
      });
      return audio;
    } as unknown as typeof window.Audio;
  });

  await page.request.post("/api/auth/login", {
    data: { password: E2E_ACCESS_PASSWORD },
  });
  await page.request.put("/api/kana/setup");

  for (const [id, name] of [["kc-default", "Kana"], ["irodori-model", "Irodori"]]) {
    const response = await page.request.post("/api/kana/voices/preview", {
      data: { id },
    });
    const body = await response.body();
    console.log(
      `API ${name}: ${response.status()} ${response.headers()["content-type"]} ${body.byteLength} bytes`,
    );
    expect(response.status()).toBe(200);
    expect(body.subarray(0, 4).toString()).toBe("RIFF");
    expect(body.byteLength).toBeGreaterThan(100_000);
  }

  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Voice/ }).click();
  await dialog.getByRole("switch", { name: "Japanese voice" }).check();

  const library = dialog.getByRole("radiogroup", { name: "Choose Kana's voice" });
  const played = () =>
    page.evaluate(
      () => (window as Window & { __previewDurations?: number[] }).__previewDurations ?? [],
    );
  for (const name of ["Kana", "Irodori"]) {
    const card = library
      .locator(".kana-wardrobe-card")
      .filter({ has: page.getByRole("radio", { name, exact: true }) });
    const preview = card.locator(".kana-voice-preview");
    const before = (await played()).length;
    await preview.click();
    await expect.poll(async () => (await played()).length).toBeGreaterThan(before);
    const durations = await played();
    console.log(`${name}: played for ${durations.at(-1)?.toFixed(2)} s`);
    expect(durations.at(-1)).toBeGreaterThan(1);
    await preview.click();
  }
  expect(synthesized).toBe(0);
  await page.screenshot({ path: "test-results/voice-preview-real.png" });
});

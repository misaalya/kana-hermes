import { expect, test } from "@playwright/test";
import {
  DEFAULT_HARU_BINDINGS,
  DEFAULT_MAO_BINDINGS,
  OFFICIAL_CUBISM_CORE_URL,
  OFFICIAL_HARU_MODEL_URL,
  OFFICIAL_MAO_MODEL_URL,
} from "../../lib/avatar/defaults";

test.setTimeout(240_000);

const HARU_PREFS = {
  onboardingCompleted: true,
  subtitleLanguage: "en",
  agentMode: "hermes",
  voiceEnabled: false,
  voiceMode: "qwen3",
  avatarMode: "live2d",
  hermes: {
    websocketUrl: "ws://127.0.0.1:9119/api/ws",
    cwd: "",
  },
  qwen3Tts: {
    baseUrl: "http://127.0.0.1:9191",
    voiceId: "Ono_Anna",
    deliveryMode: "complete",
  },
  live2d: {
    modelId: undefined,
    modelName: "Haru",
    modelUrl: OFFICIAL_HARU_MODEL_URL,
    coreScriptUrl: OFFICIAL_CUBISM_CORE_URL,
    mouthOpenParameter: DEFAULT_HARU_BINDINGS.mouthOpenParameter,
    bindingProfiles: {
      [`url:${OFFICIAL_HARU_MODEL_URL}`]: DEFAULT_HARU_BINDINGS,
      [`url:${OFFICIAL_MAO_MODEL_URL}`]: DEFAULT_MAO_BINDINGS,
    },
    hostedModels: [],
  },
};

test("renders both official samples with model-specific bindings across reloads", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript((prefs) => {
    if (localStorage.getItem("kana.preferences.v5")) return;
    localStorage.setItem("kana.preferences.v5", JSON.stringify(prefs));
  }, HARU_PREFS);

  await page.goto("/");

  // Haru loads through pixi-live2d-display and becomes the visible stage.
  const canvas = page.locator(".live2d-avatar-canvas.visible");
  await expect(canvas).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".avatar-skeleton")).toHaveCount(0);

  // Persist a switch to Mao exactly like the settings flow would.
  await page.evaluate(
    ([maoUrl, maoBindings]) => {
      const raw = localStorage.getItem("kana.preferences.v5");
      if (!raw) throw new Error("Expected Kana preferences.");
      const preferences = JSON.parse(raw);
      preferences.live2d.modelId = undefined;
      preferences.live2d.modelName = "Mao";
      preferences.live2d.modelUrl = maoUrl;
      preferences.live2d.mouthOpenParameter = maoBindings.mouthOpenParameter;
      localStorage.setItem("kana.preferences.v5", JSON.stringify(preferences));
    },
    [OFFICIAL_MAO_MODEL_URL, DEFAULT_MAO_BINDINGS] as const,
  );

  await page.reload();
  await expect(canvas).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".avatar-skeleton")).toHaveCount(0);

  const maoPreferences = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("kana.preferences.v5") ?? "{}"),
  );
  expect(maoPreferences.live2d.modelUrl).toBe(OFFICIAL_MAO_MODEL_URL);
  expect(
    maoPreferences.live2d.bindingProfiles[`url:${OFFICIAL_MAO_MODEL_URL}`]
      .mouthOpenParameter,
  ).toBe("ParamA");

  // Reload once more on Haru to prove per-model bindings survive round trips.
  await page.evaluate((haruUrl) => {
    const raw = localStorage.getItem("kana.preferences.v5");
    if (!raw) throw new Error("Expected Kana preferences.");
    const preferences = JSON.parse(raw);
    preferences.live2d.modelName = "Haru";
    preferences.live2d.modelUrl = haruUrl;
    localStorage.setItem("kana.preferences.v5", JSON.stringify(preferences));
  }, OFFICIAL_HARU_MODEL_URL);

  await page.reload();
  await expect(canvas).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".avatar-skeleton")).toHaveCount(0);

  const haruPreferences = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("kana.preferences.v5") ?? "{}"),
  );
  expect(haruPreferences.live2d.modelUrl).toBe(OFFICIAL_HARU_MODEL_URL);
  expect(
    haruPreferences.live2d.bindingProfiles[`url:${OFFICIAL_HARU_MODEL_URL}`]
      .mouthOpenParameter,
  ).toBe("ParamMouthOpenY");

  expect(pageErrors).toEqual([]);
});

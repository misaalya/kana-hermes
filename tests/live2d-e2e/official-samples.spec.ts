import { expect, test } from "@playwright/test";
import {
  DEFAULT_HARU_BINDINGS,
  OFFICIAL_CUBISM_CORE_URL,
  OFFICIAL_HARU_MODEL_URL,
  OFFICIAL_MAO_MODEL_URL,
} from "../../lib/avatar/defaults";

test.setTimeout(240_000);

test("loads and persists two official samples with model-specific bindings", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(
    ({ bindings, coreUrl, haruUrl }) => {
      if (localStorage.getItem("kana.preferences.v5")) return;
      localStorage.setItem(
        "kana.preferences.v5",
        JSON.stringify({
          onboardingCompleted: true,
          subtitleLanguage: "en",
          agentMode: "mock",
          voiceEnabled: false,
          voiceMode: "mock",
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
            modelUrl: haruUrl,
            coreScriptUrl: coreUrl,
            mouthOpenParameter: bindings.mouthOpenParameter,
            bindingProfiles: { [`url:${haruUrl}`]: bindings },
            hostedModels: [],
          },
        }),
      );
    },
    {
      bindings: DEFAULT_HARU_BINDINGS,
      coreUrl: OFFICIAL_CUBISM_CORE_URL,
      haruUrl: OFFICIAL_HARU_MODEL_URL,
    },
  );

  await page.goto("/");
  const canvas = page.locator(".live2d-avatar-canvas.visible");
  await expect(canvas).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".avatar-figure:not(.hidden)")).toHaveCount(0);

  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(
    page.getByRole("button", { name: "Use Haru official sample" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Use Mao official sample" })
    .click();
  await expect(page.getByText(/Mao selected/i)).toBeVisible();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(canvas).toBeVisible({ timeout: 90_000 });

  const maoPreferences = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("kana.preferences.v5") ?? "{}"),
  );
  expect(maoPreferences.live2d.modelUrl).toBe(OFFICIAL_MAO_MODEL_URL);
  expect(
    maoPreferences.live2d.bindingProfiles[`url:${OFFICIAL_MAO_MODEL_URL}`]
      .mouthOpenParameter,
  ).toBe("ParamA");

  await page.reload();
  await expect(canvas).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(
    page.getByRole("button", { name: "Use Mao official sample" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Use Haru official sample" })
    .click();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(canvas).toBeVisible({ timeout: 90_000 });

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

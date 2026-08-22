import type { Live2DModelBindings } from "./live2d-avatar-provider";

export const OFFICIAL_CUBISM_CORE_URL =
  "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";

const OFFICIAL_CUBISM_CORE_ORIGIN = "https://cubism.live2d.com";
const OFFICIAL_CUBISM_CORE_PATH = "/sdk-web/cubismcore/";

/**
 * Cubism Core is executable JavaScript, unlike a replaceable model package.
 * Keep it on Live2D's official HTTPS distribution path so a persisted setting
 * can never turn the avatar loader into an arbitrary script loader.
 */
export function normalizeCubismCoreUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.origin !== OFFICIAL_CUBISM_CORE_ORIGIN ||
      !url.pathname.startsWith(OFFICIAL_CUBISM_CORE_PATH) ||
      !url.pathname.endsWith(".js") ||
      url.username ||
      url.password
    ) {
      throw new Error();
    }
    url.hash = "";
    return url.toString();
  } catch {
    throw new Error(
      "Cubism Core must use Live2D's official cubism.live2d.com SDK path.",
    );
  }
}

/** Model packages are data, but still reject executable and credential URLs. */
export function normalizeLive2DModelUrl(value: string): string {
  try {
    const url = new URL(value);
    const localHttp =
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if (
      (url.protocol !== "https:" && !localHttp) ||
      url.username ||
      url.password ||
      !url.pathname.toLowerCase().endsWith(".model3.json")
    ) {
      throw new Error();
    }
    url.hash = "";
    return url.toString();
  } catch {
    throw new Error(
      "Live2D model URLs must be HTTPS (or localhost HTTP) .model3.json files without embedded credentials.",
    );
  }
}

// Pinned to an official Live2D repository commit so SDK compatibility cannot
// silently change when the upstream develop branch moves.
const OFFICIAL_SAMPLE_COMMIT =
  "b1de66b0b1f1cb881d95fb6158622aeb6a2827bd";
const OFFICIAL_SAMPLE_ROOT =
  `https://raw.githubusercontent.com/Live2D/CubismWebSamples/${OFFICIAL_SAMPLE_COMMIT}/Samples/Resources`;

export const OFFICIAL_HARU_MODEL_URL =
  `${OFFICIAL_SAMPLE_ROOT}/Haru/Haru.model3.json`;
export const OFFICIAL_MAO_MODEL_URL =
  `${OFFICIAL_SAMPLE_ROOT}/Mao/Mao.model3.json`;

export const LIVE2D_SAMPLE_COPYRIGHT_NOTICE =
  "This content uses sample data owned and copyrighted by Live2D Inc. The sample data are utilized in accordance with terms and conditions set by Live2D Inc. This content itself is created at the author's sole discretion.";

export const DEFAULT_HARU_BINDINGS: Live2DModelBindings = {
  mouthOpenParameter: "ParamMouthOpenY",
  emotionExpressions: {
    neutral: "F01",
    happy: "F05",
    sad: "F04",
    angry: "F03",
    surprised: "F06",
    thinking: "F08",
    confused: "F07",
    excited: "F02",
  },
  motions: {
    affirm: { group: "TapBody", index: 0 },
    surprise: { group: "TapBody", index: 1 },
    think: { group: "Idle", index: 1 },
    tilt: { group: "TapBody", index: 2 },
    celebrate: { group: "TapBody", index: 3 },
  },
};

// Mao intentionally uses ParamA rather than Haru's ParamMouthOpenY. Keeping it
// as the second official sample exercises the replaceable per-model binding
// boundary instead of accidentally proving the same Haru assumptions twice.
export const DEFAULT_MAO_BINDINGS: Live2DModelBindings = {
  mouthOpenParameter: "ParamA",
  emotionExpressions: {
    neutral: "exp_01",
    happy: "exp_02",
    sad: "exp_03",
    angry: "exp_04",
    surprised: "exp_05",
    thinking: "exp_06",
    confused: "exp_07",
    excited: "exp_08",
  },
  motions: {
    affirm: { group: "TapBody", index: 0 },
    surprise: { group: "TapBody", index: 1 },
    think: { group: "Idle", index: 1 },
    tilt: { group: "TapBody", index: 2 },
    celebrate: { group: "TapBody", index: 3 },
  },
};

export type OfficialLive2DSample = {
  id: "haru" | "mao";
  name: string;
  modelUrl: string;
  bindings: Live2DModelBindings;
};

export const OFFICIAL_LIVE2D_SAMPLES: readonly OfficialLive2DSample[] = [
  {
    id: "haru",
    name: "Haru",
    modelUrl: OFFICIAL_HARU_MODEL_URL,
    bindings: DEFAULT_HARU_BINDINGS,
  },
  {
    id: "mao",
    name: "Mao",
    modelUrl: OFFICIAL_MAO_MODEL_URL,
    bindings: DEFAULT_MAO_BINDINGS,
  },
];

export function officialLive2DSampleByUrl(
  modelUrl: string,
): OfficialLive2DSample | undefined {
  return OFFICIAL_LIVE2D_SAMPLES.find(
    (sample) => sample.modelUrl === modelUrl.trim(),
  );
}

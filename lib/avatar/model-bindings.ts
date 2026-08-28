import type { KanaPreferences } from "@/lib/preferences/types";
import { officialLive2DSampleByUrl } from "./defaults";
import type { Live2DModelBindings } from "./live2d-avatar-provider";

export type Live2DPreferences = KanaPreferences["live2d"];

export function live2DSourceKey(preferences: Live2DPreferences): string {
  return preferences.modelId
    ? `import:${preferences.modelId}`
    : `url:${preferences.modelUrl.trim()}`;
}

export function live2DModelBindings(
  preferences: Live2DPreferences,
): Live2DModelBindings {
  const configured = preferences.bindingProfiles?.[live2DSourceKey(preferences)];
  if (configured) {
    return {
      mouthOpenParameter:
        configured.mouthOpenParameter.trim() || "ParamMouthOpenY",
      emotionExpressions: { ...configured.emotionExpressions },
      emotionMotions: { ...configured.emotionMotions },
      motions: { ...configured.motions },
    };
  }

  const officialSample = !preferences.modelId
    ? officialLive2DSampleByUrl(preferences.modelUrl)
    : undefined;
  if (officialSample) {
    return {
      ...officialSample.bindings,
      emotionExpressions: { ...officialSample.bindings.emotionExpressions },
      emotionMotions: { ...officialSample.bindings.emotionMotions },
      motions: { ...officialSample.bindings.motions },
    };
  }

  return {
    mouthOpenParameter:
      preferences.mouthOpenParameter.trim() || "ParamMouthOpenY",
  };
}

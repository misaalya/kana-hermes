import type { KanaPreferences } from "@/lib/preferences/types";
import { officialLive2DSampleByUrl } from "./defaults";
import type { Live2DModelBindings } from "./live2d-avatar-provider";
import {
  DEFAULT_LIVE2D_MODEL_LAYOUT,
  isDefaultLive2DModelLayout,
  normalizeLive2DModelLayout,
  type Live2DModelLayout,
} from "./model-layout";

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

export function live2DModelLayout(
  preferences: Live2DPreferences,
): Live2DModelLayout {
  const configured = preferences.layoutProfiles?.[
    live2DSourceKey(preferences)
  ];
  return configured
    ? normalizeLive2DModelLayout(configured)
    : { ...DEFAULT_LIVE2D_MODEL_LAYOUT };
}

/**
 * Replace only the active model's layout profile. Keeping this operation next
 * to source-key resolution prevents workspace controls and future surfaces
 * from disagreeing about which imported or hosted avatar owns an adjustment.
 */
export function withLive2DModelLayout(
  preferences: Live2DPreferences,
  layout: Live2DModelLayout,
): Live2DPreferences {
  const sourceKey = live2DSourceKey(preferences);
  const normalized = normalizeLive2DModelLayout(layout);
  const layoutProfiles = { ...preferences.layoutProfiles };
  if (isDefaultLive2DModelLayout(normalized)) {
    delete layoutProfiles[sourceKey];
  } else {
    layoutProfiles[sourceKey] = normalized;
  }
  return { ...preferences, layoutProfiles };
}

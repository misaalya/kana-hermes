import { DEFAULT_SUBTITLE_LANGUAGE } from "@/lib/presentation/languages";
import { isUiLocale } from "@/lib/ui/copy";
import {
  DEFAULT_HARU_BINDINGS,
  OFFICIAL_CUBISM_CORE_URL,
  OFFICIAL_HARU_MODEL_URL,
  normalizeCubismCoreUrl,
  normalizeLive2DModelUrl,
} from "@/lib/avatar/defaults";
import {
  DEFAULT_QWEN3_TTS_BASE_URL,
  DEFAULT_QWEN3_TTS_VOICE_ID,
  normalizeQwen3TTSBaseUrl,
} from "@/lib/voice/qwen3-tts-contract";
import type {
  KanaPreferences,
  PreferencesStore,
} from "./types";

type BrowserStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

// Preferences hold presentation choices only. The Hermes endpoint and session
// token are deliberately absent: the browser reaches Hermes through the Kana
// server relay and never stores connection credentials.

const STORAGE_KEY = "kana.preferences.v5";
const LEGACY_STORAGE_KEYS = [
  "kana.preferences.v4",
  "kana.preferences.v3",
  "kana.preferences.v2",
  "kana.preferences.v1",
];

type StoredPreferences = Partial<
  Omit<KanaPreferences, "hermes" | "qwen3Tts">
> & {
  hermes?: Partial<KanaPreferences["hermes"]> & {
    // Legacy fields are tolerated on read and dropped on persist.
    websocketUrl?: string;
    token?: string;
  };
  qwen3Tts?: Partial<KanaPreferences["qwen3Tts"]> & { endpoint?: string };
};

export const DEFAULT_PREFERENCES: KanaPreferences = {
  onboardingCompleted: false,
  uiLocale: "id",
  subtitleLanguage: DEFAULT_SUBTITLE_LANGUAGE,
  agentMode: "hermes",
  voiceEnabled: true,
  voiceMode: "qwen3",
  avatarMode: "live2d",
  hermes: {
    cwd: "",
  },
  qwen3Tts: {
    baseUrl: DEFAULT_QWEN3_TTS_BASE_URL,
    voiceId: DEFAULT_QWEN3_TTS_VOICE_ID,
    deliveryMode: "complete",
  },
  live2d: {
    modelUrl: OFFICIAL_HARU_MODEL_URL,
    coreScriptUrl: OFFICIAL_CUBISM_CORE_URL,
    mouthOpenParameter: DEFAULT_HARU_BINDINGS.mouthOpenParameter,
    bindingProfiles: {},
    hostedModels: [],
  },
};

export function normalizeKanaPreferences(
  preferences: KanaPreferences,
): KanaPreferences {
  return {
    ...preferences,
    // Runtime guard: stored or restored values can never re-enable another
    // mode — Kana always talks to Hermes, Qwen3-TTS, and Live2D.
    agentMode: "hermes",
    voiceMode: "qwen3",
    avatarMode: "live2d",
    uiLocale: isUiLocale(preferences.uiLocale) ? preferences.uiLocale : "id",
    hermes: {
      cwd: preferences.hermes.cwd,
    },
    qwen3Tts: {
      ...preferences.qwen3Tts,
      baseUrl: normalizeQwen3TTSBaseUrl(preferences.qwen3Tts.baseUrl),
    },
    live2d: {
      ...preferences.live2d,
      modelUrl: normalizeLive2DModelUrl(preferences.live2d.modelUrl),
      coreScriptUrl: normalizeCubismCoreUrl(preferences.live2d.coreScriptUrl),
      hostedModels: (preferences.live2d.hostedModels ?? []).map((candidate) => ({
        ...candidate,
        url: normalizeLive2DModelUrl(candidate.url),
      })),
    },
  };
}

export class LocalPreferencesStore implements PreferencesStore {
  private warning: string | null = null;
  constructor(private readonly storage?: BrowserStorage) {}

  load(): KanaPreferences {
    this.warning = null;
    const storage = this.getStorage();
    if (!storage) return DEFAULT_PREFERENCES;

    try {
      const current = storage.getItem(STORAGE_KEY);
      const legacy = LEGACY_STORAGE_KEYS.map((key) => storage.getItem(key)).find(
        Boolean,
      );
      const raw = current ?? legacy;
      if (!raw) {
        return DEFAULT_PREFERENCES;
      }
      const value = JSON.parse(raw) as StoredPreferences;
      const migratedFromLegacy = !current && Boolean(legacy);
      const legacyEndpoint = value.qwen3Tts?.endpoint;
      let baseUrl = value.qwen3Tts?.baseUrl ?? legacyEndpoint;
      try {
        baseUrl = normalizeQwen3TTSBaseUrl(baseUrl ?? "");
      } catch {
        baseUrl = DEFAULT_PREFERENCES.qwen3Tts.baseUrl;
      }
      let coreScriptUrl = value.live2d?.coreScriptUrl;
      let modelUrl = value.live2d?.modelUrl;
      try {
        coreScriptUrl = normalizeCubismCoreUrl(
          coreScriptUrl ?? DEFAULT_PREFERENCES.live2d.coreScriptUrl,
        );
      } catch {
        coreScriptUrl = DEFAULT_PREFERENCES.live2d.coreScriptUrl;
      }
      try {
        modelUrl = normalizeLive2DModelUrl(
          modelUrl ?? DEFAULT_PREFERENCES.live2d.modelUrl,
        );
      } catch {
        modelUrl = DEFAULT_PREFERENCES.live2d.modelUrl;
      }
      const hostedModels = Array.isArray(value.live2d?.hostedModels)
        ? value.live2d.hostedModels
            .slice(0, 100)
            .flatMap((candidate) => {
              if (
                !candidate ||
                typeof candidate.id !== "string" ||
                typeof candidate.name !== "string" ||
                typeof candidate.url !== "string"
              ) {
                return [];
              }
              try {
                return [{
                  id: candidate.id.slice(0, 500),
                  name: candidate.name.slice(0, 500),
                  url: normalizeLive2DModelUrl(candidate.url),
                  addedAt:
                    typeof candidate.addedAt === "number"
                      ? candidate.addedAt
                      : Date.now(),
                }];
              } catch {
                return [];
              }
            })
        : [];
      const preferences: KanaPreferences = {
        ...DEFAULT_PREFERENCES,
        ...value,
        onboardingCompleted:
          value.onboardingCompleted ?? migratedFromLegacy,
        hermes: {
          cwd:
            typeof value.hermes?.cwd === "string"
              ? value.hermes.cwd
              : DEFAULT_PREFERENCES.hermes.cwd,
        },
        qwen3Tts: {
          ...DEFAULT_PREFERENCES.qwen3Tts,
          ...value.qwen3Tts,
          baseUrl,
          deliveryMode:
            value.qwen3Tts?.deliveryMode === "sentence_chunks"
              ? "sentence_chunks"
              : "complete",
        },
        live2d: {
          ...DEFAULT_PREFERENCES.live2d,
          ...value.live2d,
          coreScriptUrl,
          modelUrl,
          hostedModels,
        },
      };
      const normalizedPreferences = normalizeKanaPreferences(preferences);
      try {
        this.persistSanitized(storage, normalizedPreferences);
      } catch {
        // Loading existing preferences should still succeed when browser
        // storage is temporarily unavailable or over quota.
      }
      return normalizedPreferences;
    } catch {
      this.warning =
        "Kana could not read stored preferences. Safe defaults are active, and the unreadable record was kept for recovery.";
      return DEFAULT_PREFERENCES;
    }
  }

  consumeWarning(): string | null {
    const warning = this.warning;
    this.warning = null;
    return warning;
  }

  save(preferences: KanaPreferences): void {
    const normalized = normalizeKanaPreferences(preferences);
    const storage = this.getStorage();
    if (!storage) return;
    this.persistSanitized(storage, normalized);
  }

  private persistSanitized(
    storage: BrowserStorage,
    preferences: KanaPreferences,
  ): void {
    let qwenBaseUrl = DEFAULT_PREFERENCES.qwen3Tts.baseUrl;
    let modelUrl = DEFAULT_PREFERENCES.live2d.modelUrl;
    let coreScriptUrl = DEFAULT_PREFERENCES.live2d.coreScriptUrl;
    try {
      qwenBaseUrl = normalizeQwen3TTSBaseUrl(preferences.qwen3Tts.baseUrl);
    } catch {
      // Keep the known-safe local default.
    }
    try {
      modelUrl = normalizeLive2DModelUrl(preferences.live2d.modelUrl);
    } catch {
      // Keep the pinned official sample.
    }
    try {
      coreScriptUrl = normalizeCubismCoreUrl(preferences.live2d.coreScriptUrl);
    } catch {
      // Keep the official executable Core URL.
    }
    const hostedModels = (preferences.live2d.hostedModels ?? []).flatMap(
      (candidate) => {
        try {
          return [{ ...candidate, url: normalizeLive2DModelUrl(candidate.url) }];
        } catch {
          return [];
        }
      },
    );
    const persistent: KanaPreferences = {
      ...preferences,
      hermes: {
        cwd: preferences.hermes.cwd,
      },
      qwen3Tts: { ...preferences.qwen3Tts, baseUrl: qwenBaseUrl },
      live2d: {
        ...preferences.live2d,
        modelUrl,
        coreScriptUrl,
        hostedModels,
      },
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(persistent));
    this.removeLegacy(storage);
  }

  private removeLegacy(storage: BrowserStorage): void {
    for (const key of LEGACY_STORAGE_KEYS) storage.removeItem(key);
  }

  private getStorage(): BrowserStorage | null {
    if (this.storage) return this.storage;
    return typeof window === "undefined" ? null : window.localStorage;
  }
}

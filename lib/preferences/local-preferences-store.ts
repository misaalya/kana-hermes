import { isUiLocale } from "@/lib/ui/copy";
import {
  DEFAULT_HARU_BINDINGS,
  OFFICIAL_CUBISM_CORE_URL,
  OFFICIAL_HARU_MODEL_URL,
  normalizeCubismCoreUrl,
  normalizeLive2DModelUrl,
} from "@/lib/avatar/defaults";
import { normalizeLive2DLayoutProfiles } from "@/lib/avatar/model-layout";
import type {
  KanaPreferences,
  PreferencesStore,
} from "./types";
import { isStageBackground } from "./types";

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
  Omit<KanaPreferences, "hermes" | "voice">
> & {
  hermes?: Partial<KanaPreferences["hermes"]> & {
    // Legacy fields are tolerated on read and dropped on persist.
    websocketUrl?: string;
    token?: string;
  };
  voice?: Partial<KanaPreferences["voice"]>;
  /** Builds with the Qwen3-TTS service kept voice choices here. */
  qwen3Tts?: { deliveryMode?: unknown; voiceId?: unknown; baseUrl?: unknown; endpoint?: unknown };
};

export const DEFAULT_PREFERENCES: KanaPreferences = {
  onboardingCompleted: false,
  uiLocale: "id",
  agentMode: "hermes",
  // Local speech needs a multi-gigabyte engine download, so it is opt-in.
  voiceEnabled: false,
  voiceMode: "configured",
  avatarMode: "live2d",
  stageBackground: "plain",
  hermes: {
    cwd: "",
  },
  voice: {
    voiceId: "",
    deliveryMode: "complete",
  },
  live2d: {
    modelUrl: OFFICIAL_HARU_MODEL_URL,
    coreScriptUrl: OFFICIAL_CUBISM_CORE_URL,
    mouthOpenParameter: DEFAULT_HARU_BINDINGS.mouthOpenParameter,
    bindingProfiles: {},
    layoutProfiles: {},
    hostedModels: [],
  },
};

export function normalizeKanaPreferences(
  preferences: KanaPreferences,
): KanaPreferences {
  const customBackgroundId = typeof preferences.customBackgroundId === "string"
    && preferences.customBackgroundId.trim()
    ? preferences.customBackgroundId.slice(0, 500)
    : undefined;
  const stageBackground = isStageBackground(preferences.stageBackground)
    && (preferences.stageBackground !== "custom" || Boolean(customBackgroundId))
    ? preferences.stageBackground
    : "plain";
  // Subtitles follow the language the user writes in; drop the retired
  // per-browser subtitle language setting from older stored preferences.
  const { subtitleLanguage: _retired, qwen3Tts: _retiredVoice, ...current } = preferences as KanaPreferences & {
    subtitleLanguage?: unknown;
    qwen3Tts?: unknown;
  };
  void _retired;
  void _retiredVoice;
  return {
    ...current,
    // Runtime guard: stored or restored values can never re-enable another
    // mode — Kana always talks to Hermes and Live2D; the TTS provider is
    // selected server-side so its credentials never enter browser storage.
    agentMode: "hermes",
    voiceMode: "configured",
    avatarMode: "live2d",
    stageBackground,
    customBackgroundId,
    uiLocale: isUiLocale(preferences.uiLocale) ? preferences.uiLocale : "id",
    hermes: {
      cwd: preferences.hermes.cwd,
    },
    voice: {
      voiceId: typeof preferences.voice?.voiceId === "string" ? preferences.voice.voiceId.slice(0, 500) : "",
      deliveryMode: preferences.voice?.deliveryMode === "sentence_chunks" ? "sentence_chunks" : "complete",
    },
    live2d: {
      ...preferences.live2d,
      modelUrl: normalizeLive2DModelUrl(preferences.live2d.modelUrl),
      coreScriptUrl: normalizeCubismCoreUrl(preferences.live2d.coreScriptUrl),
      layoutProfiles: normalizeLive2DLayoutProfiles(
        preferences.live2d.layoutProfiles,
      ),
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
        voice: {
          // Qwen voice ids named service-side profiles that no longer exist,
          // so a migrated selection starts from the bundled Kana voice.
          voiceId: typeof value.voice?.voiceId === "string" ? value.voice.voiceId : "",
          deliveryMode:
            (value.voice?.deliveryMode ?? value.qwen3Tts?.deliveryMode) === "sentence_chunks"
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
    let modelUrl = DEFAULT_PREFERENCES.live2d.modelUrl;
    let coreScriptUrl = DEFAULT_PREFERENCES.live2d.coreScriptUrl;
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

import { readKanaUserConfig, type KanaUserConfig } from "@/lib/server/user-config";
import { IrodoriLocalTtsProvider } from "./irodori-local-provider";
import {
  OpenAiCompatibleTtsProvider,
  openAiCompatibleConfigFromUserConfig,
} from "./openai-compatible-provider";
import type { ServerTtsProvider } from "./types";

/** Resolve on each request so editing config.json does not retain a stale API key. */
export function getConfiguredTtsProvider(config: KanaUserConfig["tts"] = readKanaUserConfig().tts): ServerTtsProvider {
  if (config?.provider === "openai-compatible") {
    return new OpenAiCompatibleTtsProvider(openAiCompatibleConfigFromUserConfig(config));
  }
  return new IrodoriLocalTtsProvider();
}

export type {
  ServerTtsProvider,
  TtsAudioResult,
  TtsProviderCapabilities,
  TtsProviderDescriptor,
  TtsSynthesisInput,
} from "./types";
export { TtsProviderError } from "./types";

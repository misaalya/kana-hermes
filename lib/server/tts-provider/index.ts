import { readKanaUserConfig } from "@/lib/server/user-config";
import { LocalQwen3TtsProvider } from "./local-qwen3-provider";
import {
  OpenAiCompatibleTtsProvider,
  openAiCompatibleConfigFromUserConfig,
} from "./openai-compatible-provider";
import type { ServerTtsProvider } from "./types";

/** Resolve on each request so editing config.json does not retain a stale API key. */
export function getConfiguredTtsProvider(): ServerTtsProvider {
  const config = readKanaUserConfig().tts;
  const provider = config?.provider ?? "qwen3-local";
  if (provider === "openai-compatible") {
    return new OpenAiCompatibleTtsProvider(openAiCompatibleConfigFromUserConfig(config));
  }
  return new LocalQwen3TtsProvider();
}

export type {
  ServerTtsProvider,
  TtsAudioResult,
  TtsProviderCapabilities,
  TtsProviderDescriptor,
  TtsSynthesisInput,
} from "./types";
export { TtsProviderError } from "./types";

// Compatibility entry point for older imports. Synthesis selection now lives
// on the server; browser playback uses the provider-neutral relay class.
export {
  TtsRelayProvider as Qwen3TTSProvider,
} from "./tts-relay-provider";
export type {
  TtsRelayProviderOptions as Qwen3TTSProviderOptions,
} from "./tts-relay-provider";

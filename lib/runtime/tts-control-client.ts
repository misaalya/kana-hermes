import type { TtsRuntimeStatus } from "@/components/kana/tts-control-panel";

// Browser-side client for the TTS runtime control relay. Same shape as the
// Hermes control client: session-cookie auth, no service addresses exposed.

async function parse(response: Response): Promise<TtsRuntimeStatus> {
  const value = (await response.json()) as TtsRuntimeStatus & { error?: string };
  if (!response.ok) {
    throw new Error(value.error ?? `TTS control returned HTTP ${response.status}.`);
  }
  return value;
}

export function inspectTtsRuntime(): Promise<TtsRuntimeStatus> {
  return fetch("/api/voice/tts/status", {
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
  }).then(parse);
}

export async function controlTtsRuntime(options: {
  action: "start" | "restart" | "stop";
}): Promise<TtsRuntimeStatus> {
  if (options.action === "stop") {
    return fetch("/api/voice/tts/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "stop" }),
    }).then(parse);
  }
  // Start/restart block until ready; surface honest errors on failure.
  return fetch("/api/voice/tts/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action: options.action }),
  }).then(parse);
}

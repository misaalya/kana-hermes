import { withSession } from "@/lib/server/api-response";
import { getConfiguredTtsProvider } from "@/lib/server/tts-provider";
import {
  probeOnlyPortOr503,
  providerConflict,
  relayUpstream,
  ttsServiceUrl,
} from "@/lib/server/tts-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Relay GET /v1/setup: disk/cache info from the upstream. Probe-only — a
// setup check must not cold-start the model; spawning happens through the
// explicit control routes or ensure-on-use speech.
const UPSTREAM_TIMEOUT_MS = 5_000;

export const GET = withSession(async () => {
  if (getConfiguredTtsProvider().descriptor.type !== "qwen3-local") {
    return providerConflict("Setup information is only available for local Qwen3-TTS.");
  }
  const ensured = await probeOnlyPortOr503();
  if (!ensured.ok) return ensured.response;
  // A 404 from upstream means the setup endpoint isn't available — relay it.
  return relayUpstream(ttsServiceUrl(ensured.port, "/v1/setup"), {
    headers: { Accept: "application/json" },
    timeoutMs: UPSTREAM_TIMEOUT_MS,
    failure: "Setup check failed",
  });
});

import { NO_STORE, withSession } from "@/lib/server/api-response";
import {
  ensureQwen3TTSService,
  inspectLocalQwen3TtsRuntime,
} from "@/lib/server/local-qwen3-tts-runtime";
import { getConfiguredTtsProvider } from "@/lib/server/tts-provider";
import { providerConflict, uncontrolledProviderStatus } from "@/lib/server/tts-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Non-blocking status for the UI: reports the current runtime state and, when
// `ensure=true` (GET) or on POST, kicks off discovery/spawn through the shared
// single-flight so the status flips to running/external without the request
// blocking on model load. A failed attempt is recorded in the runtime status
// (state "failed" plus its message), so later polls report it honestly.

async function managedStatus(): Promise<Response> {
  return Response.json(
    {
      ...(await inspectLocalQwen3TtsRuntime()),
      provider: getConfiguredTtsProvider().descriptor,
      controllable: true,
    },
    { headers: NO_STORE },
  );
}

export const GET = withSession(async (request) => {
  const provider = getConfiguredTtsProvider();
  if (!provider.descriptor.capabilities.runtimeControl) return uncontrolledProviderStatus(provider);
  if (new URL(request.url).searchParams.get("ensure") === "true") void ensureQwen3TTSService();
  return managedStatus();
});

export const POST = withSession(async () => {
  const provider = getConfiguredTtsProvider();
  if (!provider.descriptor.capabilities.runtimeControl) {
    return providerConflict(`${provider.descriptor.name} has no local runtime to start.`);
  }
  void ensureQwen3TTSService();
  return managedStatus();
});

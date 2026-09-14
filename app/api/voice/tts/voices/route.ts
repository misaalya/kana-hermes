import { jsonError, withSession } from "@/lib/server/api-response";
import { readBoundedText } from "@/lib/server/request-body";
import { getConfiguredTtsProvider } from "@/lib/server/tts-provider";
import {
  ensureOr503,
  providerConflict,
  relayUpstream,
  ttsServiceUrl,
} from "@/lib/server/tts-relay";
import { MAX_REQUEST_BODY_BYTES } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Relay voice management: GET /v1/voices, POST /v1/voices/clone,
// DELETE /v1/voices/{id} — method-dispatched so voice cloning works through
// the relay too.
const UPSTREAM_TIMEOUT_MS = 60_000;

async function forward(pathname: string, init?: RequestInit): Promise<Response> {
  const provider = getConfiguredTtsProvider();
  if (!provider.descriptor.capabilities.voiceLibrary) {
    return providerConflict(`${provider.descriptor.name} does not expose Kana's local voice library.`);
  }
  const ensured = await ensureOr503();
  if (!ensured.ok) return ensured.response;
  return relayUpstream(ttsServiceUrl(ensured.port, pathname), {
    ...init,
    timeoutMs: UPSTREAM_TIMEOUT_MS,
    failure: "TTS service request failed",
  });
}

export const GET = withSession(async () => forward("/v1/voices"));

export const POST = withSession(async (request) => {
  let body: string;
  try {
    body = await readBoundedText(request, MAX_REQUEST_BODY_BYTES);
  } catch (error) {
    return jsonError(error);
  }
  return forward("/v1/voices/clone", {
    method: "POST",
    headers: { "Content-Type": request.headers.get("Content-Type") ?? "application/json" },
    body,
  });
});

export const DELETE = withSession(async (request) => {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing voice id." }, { status: 400 });
  return forward(`/v1/voices/${encodeURIComponent(id)}`, { method: "DELETE" });
});

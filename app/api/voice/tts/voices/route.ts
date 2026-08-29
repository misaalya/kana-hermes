import { ensureOr503, requireSession, ttsServiceUrl } from "@/lib/server/tts-relay";
import { getConfiguredTtsProvider } from "@/lib/server/tts-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Relay voice management: GET /v1/voices, POST /v1/voices/clone,
// DELETE /v1/voices/{id} — method-dispatched so voice cloning works through
// the relay too.

async function forward(
  request: Request,
  pathname: string,
  init?: RequestInit,
): Promise<Response> {
  const provider = getConfiguredTtsProvider();
  if (!provider.descriptor.capabilities.voiceLibrary) {
    return Response.json(
      { error: `${provider.descriptor.name} does not expose Kana's local voice library.` },
      { status: 409 },
    );
  }
  const ensured = await ensureOr503();
  if (!ensured.ok) return ensured.response;
  try {
    const upstream = await fetch(ttsServiceUrl(ensured.port, pathname), {
      ...init,
      signal: AbortSignal.timeout(60_000),
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? `TTS service request failed: ${error.message}`
            : "TTS service request failed.",
      },
      { status: 502 },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  return forward(request, "/v1/voices");
}

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  const body = await request.text();
  return forward(request, "/v1/voices/clone", {
    method: "POST",
    headers: { "Content-Type": request.headers.get("Content-Type") ?? "application/json" },
    body,
  });
}

export async function DELETE(request: Request): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing voice id." }, { status: 400 });
  return forward(request, `/v1/voices/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

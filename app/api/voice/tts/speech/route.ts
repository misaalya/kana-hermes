import { ensureOr503, requireSession, ttsServiceUrl } from "@/lib/server/tts-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Relay POST /v1/speech: JSON in (text/voice), raw audio bytes out. The
// request may block for a long time while the model loads or synthesizes on
// CPU, so the upstream timeout is generous and configurable.
const UPSTREAM_TIMEOUT_MS = Number(
  process.env.KANA_TTS_RELAY_TIMEOUT_MS ?? "300000",
);

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  const ensured = await ensureOr503();
  if (!ensured.ok) return ensured.response;
  try {
    const body = await request.text();
    const upstream = await fetch(ttsServiceUrl(ensured.port, "/v1/speech"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      // A browser abort must break the upstream fetch so Python's
      // request.is_disconnected() fires and sets its cancel event; the
      // timeout still bounds a wedged upstream on its own.
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      ]),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? `TTS synthesis failed: ${error.message}`
            : "TTS synthesis failed.",
      },
      { status: 502 },
    );
  }
}

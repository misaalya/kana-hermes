import { ensureOr503, requireSession, ttsServiceUrl } from "@/lib/server/tts-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Relay GET /v1/health: probes the upstream and returns its health JSON.
const UPSTREAM_TIMEOUT_MS = 5_000;

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  const ensured = await ensureOr503();
  if (!ensured.ok) return ensured.response;
  try {
    const upstream = await fetch(ttsServiceUrl(ensured.port, "/v1/health"), {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Health check failed." },
      { status: 502 },
    );
  }
}
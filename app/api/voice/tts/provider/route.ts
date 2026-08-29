import { getConfiguredTtsProvider } from "@/lib/server/tts-provider";
import { requireSession } from "@/lib/server/tts-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Safe provider metadata and health. Credentials and upstream URLs stay server-side. */
export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  try {
    const provider = getConfiguredTtsProvider();
    return Response.json(
      { provider: provider.descriptor, status: await provider.inspect() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "TTS provider configuration failed.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

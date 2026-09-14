import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import { getConfiguredTtsProvider } from "@/lib/server/tts-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Safe provider metadata and health. Credentials and upstream URLs stay server-side. */
export const GET = withSession(async () => {
  try {
    const provider = getConfiguredTtsProvider();
    return Response.json(
      { provider: provider.descriptor, status: await provider.inspect() },
      { headers: NO_STORE },
    );
  } catch (error) {
    return jsonError(error, 500);
  }
});

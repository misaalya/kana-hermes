import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import { InstaboxWakeError, wakeRemoteHermes } from "@/lib/server/instabox-wake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kana's own control for the operator-configured Instabox VM. The browser can
// ask for a wake, but cannot name a command, a machine, or an endpoint; those
// are server configuration, and the CLI runs without a shell.
export const POST = withSession(async () => {
  try {
    const result = await wakeRemoteHermes();
    return Response.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof InstaboxWakeError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: NO_STORE },
      );
    }
    return jsonError(error, 502);
  }
});

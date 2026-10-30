import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import {
  InstaboxWakeError,
  instaboxMachineStatus,
  wakeRemoteHermes,
} from "@/lib/server/instabox-wake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kana's own control for the operator-configured Instabox VM. The browser can
// ask for a wake or read whether the machine is already up, but cannot name a
// command, a machine, or an endpoint; those are server configuration, and the
// CLI runs without a shell.
export const GET = withSession(async () => {
  try {
    const status = await instaboxMachineStatus();
    return Response.json({ ok: true, ...status }, { headers: NO_STORE });
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

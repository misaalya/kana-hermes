import { NO_STORE, withSession } from "@/lib/server/api-response";
import { readUpdateStatus } from "@/lib/server/update-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reports the running version and, when npm has a newer release, the command
// the user runs to install it. Kana never runs npm itself.
export const GET = withSession(async () => {
  return Response.json(await readUpdateStatus(), { headers: NO_STORE });
});

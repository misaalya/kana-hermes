import { NO_STORE } from "@/lib/server/api-response";
import {
  clearSessionCookie,
  revokeSessionToken,
  sessionTokenFromRequest,
} from "@/lib/server/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // Revoke server-side too: clearing the cookie alone would leave a copied
  // token valid until it expired.
  await revokeSessionToken(sessionTokenFromRequest(request));
  return Response.json(
    { ok: true },
    { status: 200, headers: { "Set-Cookie": clearSessionCookie(), ...NO_STORE } },
  );
}

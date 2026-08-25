import { isInsecureNoAuthMode, isAuthEnabled } from "@/lib/server/auth/password-store";
import { isSessionValid } from "@/lib/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return Response.json(
    {
      authEnabled: isAuthEnabled(),
      authenticated: await isSessionValid(request),
      // True only in production with no authentication configured. UI layers
      // may use it to surface the exposure; see docs/SECURITY.md.
      insecureNoAuth: isInsecureNoAuthMode(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

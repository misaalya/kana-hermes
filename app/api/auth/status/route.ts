import { isUsingDefaultPassword } from "@/lib/server/auth/password-store";
import { isSessionValid } from "@/lib/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return Response.json(
    {
      // Authentication is always enabled (SQLite-backed password with the
      // seeded default); the flag stays for UI compatibility.
      authEnabled: true,
      authenticated: await isSessionValid(request),
      // The well-known default ("123456") is still active. The login page and
      // settings use this to push the operator toward setting a real one.
      usingDefaultPassword: isUsingDefaultPassword(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

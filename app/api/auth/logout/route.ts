import { clearSessionCookie } from "@/lib/server/auth/session";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  return Response.json(
    { ok: true },
    {
      status: 200,
      headers: { "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" },
    },
  );
}

import { readJsonObject, RequestBodyError } from "@/lib/server/request-body";
import { verifyAccessPassword, changeAccessPassword } from "@/lib/server/auth/password-store";
import { createSessionToken, isSessionValid, sessionCookie } from "@/lib/server/auth/session";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

// Change the shared access password. Requires an authenticated session and a
// correct current password (re-auth for sensitive actions), then persists a
// bcrypt hash that takes precedence over the built-in first-login password.
export async function POST(request: Request): Promise<Response> {
  if (!(await isSessionValid(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await readJsonObject(request, 4096);
  } catch (error) {
    return Response.json(
      { error: error instanceof RequestBodyError ? error.message : "A JSON object is required." },
      { status: error instanceof RequestBodyError ? error.status : 400, headers: NO_STORE },
    );
  }

  const { currentPassword, newPassword } = body;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return Response.json(
      { error: "Current and new passwords are required." },
      { status: 400, headers: NO_STORE },
    );
  }

  if (!(await verifyAccessPassword(currentPassword))) {
    return Response.json({ error: "Current password is incorrect." }, { status: 403, headers: NO_STORE });
  }

  try {
    await changeAccessPassword(newPassword);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not change the password." },
      { status: 400, headers: NO_STORE },
    );
  }

  // The password update revokes previous tokens; issue a replacement for this browser.
  const token = await createSessionToken();
  return Response.json(
    { ok: true },
    { status: 200, headers: { "Set-Cookie": sessionCookie(token, request), ...NO_STORE } },
  );
}

import { verifyAccessPassword, changeAccessPassword } from "@/lib/server/auth/password-store";
import { createSessionToken, isSessionValid, sessionCookie } from "@/lib/server/auth/session";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

// Change the shared access password. Requires an authenticated session and a
// correct current password (re-auth for sensitive actions), then persists a
// bcrypt hash that takes precedence over the bootstrap environment password.
export async function POST(request: Request): Promise<Response> {
  if (!(await isSessionValid(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = (await request.json()) as { currentPassword?: unknown; newPassword?: unknown };
  } catch {
    return Response.json({ error: "A request body is required." }, { status: 400 });
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

  // Rotate the session so other tabs keep working under the new secret state.
  const token = await createSessionToken();
  return Response.json(
    { ok: true },
    { status: 200, headers: { "Set-Cookie": sessionCookie(token, request), ...NO_STORE } },
  );
}

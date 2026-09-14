import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import { readJsonObject } from "@/lib/server/request-body";
import { verifyAccessPassword, changeAccessPassword } from "@/lib/server/auth/password-store";
import {
  createLoginDeviceToken,
  createSessionToken,
  loginDeviceCookie,
  sessionCookie,
} from "@/lib/server/auth/session";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4096;

// Change the shared access password. Requires an authenticated session and a
// correct current password (re-auth for sensitive actions). The initial
// password is never set here; see `kana password`.
export const POST = withSession(async (request) => {
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request, MAX_BODY_BYTES);
  } catch (error) {
    return jsonError(error);
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
    return jsonError(error);
  }

  // The password update revokes previous sessions and demotes every login
  // device; issue replacements so this browser stays signed in and known.
  const headers = new Headers(NO_STORE);
  headers.append("Set-Cookie", sessionCookie(await createSessionToken(), request));
  headers.append("Set-Cookie", loginDeviceCookie(await createLoginDeviceToken(), request));
  return Response.json({ ok: true }, { status: 200, headers });
});

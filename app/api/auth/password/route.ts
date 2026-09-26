import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import { readJsonObject } from "@/lib/server/request-body";
import { verifyAccessPassword, changeAccessPassword } from "@/lib/server/auth/password-store";
import {
  beginLoginAttempt,
  checkLock,
  recordFail,
  recordSuccess,
  type LoginBucket,
} from "@/lib/server/auth/login-limiter";
import {
  createLoginDeviceToken,
  createSessionToken,
  loginDeviceCookie,
  loginDeviceIdFromRequest,
  sessionCookie,
} from "@/lib/server/auth/session";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4096;

function lockedResponse(retryAfter: number): Response {
  return Response.json(
    { error: `Too many failed attempts. Try again in ${retryAfter}s.`, retryAfter },
    { status: 429, headers: { ...NO_STORE, "Retry-After": String(retryAfter) } },
  );
}

// Change the shared access password. Requires an authenticated session and a
// correct current password (re-auth for sensitive actions). The initial
// password is never set here; see `kana password`. The current password is a
// guess like any login, so it counts against the same limiter bucket: a
// stolen session cookie must not become an unlimited password oracle.
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

  const deviceId = await loginDeviceIdFromRequest(request);
  const bucket: LoginBucket = deviceId ? { kind: "device", deviceId } : { kind: "unknown" };
  const attempt = beginLoginAttempt(bucket);
  if (attempt.locked) return lockedResponse(attempt.retryAfter);
  try {
    if (!(await verifyAccessPassword(currentPassword))) {
      recordFail(bucket);
      const lock = checkLock(bucket);
      if (lock.locked) return lockedResponse(lock.retryAfter);
      return Response.json({ error: "Current password is incorrect." }, { status: 403, headers: NO_STORE });
    }
    recordSuccess(bucket);
    await changeAccessPassword(newPassword);
  } catch (error) {
    return jsonError(error);
  } finally {
    attempt.release();
  }

  // The password update revokes previous sessions and demotes every login
  // device; issue replacements so this browser stays signed in and known.
  const headers = new Headers(NO_STORE);
  headers.append("Set-Cookie", sessionCookie(await createSessionToken(), request));
  headers.append("Set-Cookie", loginDeviceCookie(await createLoginDeviceToken(), request));
  return Response.json({ ok: true }, { status: 200, headers });
});

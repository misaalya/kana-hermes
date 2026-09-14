import { jsonError, NO_STORE } from "@/lib/server/api-response";
import { readJsonObject } from "@/lib/server/request-body";
import {
  beginLoginAttempt,
  checkLock,
  recordFail,
  recordSuccess,
  type LoginBucket,
} from "@/lib/server/auth/login-limiter";
import {
  accessSessionVersion,
  isAccessPasswordConfigured,
  verifyAccessPassword,
} from "@/lib/server/auth/password-store";
import {
  createLoginDeviceToken,
  createSessionToken,
  loginDeviceCookie,
  loginDeviceIdFromRequest,
  sessionCookie,
} from "@/lib/server/auth/session";

export const runtime = "nodejs";

const MAX_LOGIN_BODY_BYTES = 4096;

function lockedResponse(retryAfter: number, message: string): Response {
  return Response.json(
    { error: message, retryAfter },
    { status: 429, headers: { ...NO_STORE, "Retry-After": String(retryAfter) } },
  );
}

// Single shared access password with progressive lockout. There are no user
// accounts to enumerate. See login-limiter.ts for the bucket model.
export async function POST(request: Request): Promise<Response> {
  if (!isAccessPasswordConfigured()) {
    return Response.json(
      {
        error: "No access password has been set. Run `kana password` on the server first.",
        code: "password_not_configured",
      },
      { status: 503, headers: NO_STORE },
    );
  }

  const deviceId = await loginDeviceIdFromRequest(request);
  const bucket: LoginBucket = deviceId ? { kind: "device", deviceId } : { kind: "unknown" };

  const lock = checkLock(bucket);
  if (lock.locked) {
    return lockedResponse(lock.retryAfter, `Too many failed attempts. Try again in ${lock.retryAfter}s.`);
  }

  let password: unknown;
  try {
    ({ password } = await readJsonObject(request, MAX_LOGIN_BODY_BYTES));
  } catch (error) {
    return jsonError(error);
  }
  if (typeof password !== "string" || password.length === 0) {
    return Response.json({ error: "Password is required." }, { status: 400, headers: NO_STORE });
  }

  const attempt = beginLoginAttempt(bucket);
  if (attempt.locked) {
    return lockedResponse(attempt.retryAfter, "Login is temporarily limited. Please retry shortly.");
  }
  try {
    const verifiedVersion = accessSessionVersion();
    if (!(await verifyAccessPassword(password))) {
      const { remainingBeforeLock } = recordFail(bucket);
      const postLock = checkLock(bucket);
      if (postLock.locked) {
        return lockedResponse(
          postLock.retryAfter,
          `Too many failed attempts. Try again in ${postLock.retryAfter}s.`,
        );
      }
      return Response.json(
        {
          error:
            remainingBeforeLock > 0
              ? `Invalid password. ${remainingBeforeLock} attempt(s) left before lockout.`
              : "Invalid password.",
          remainingBeforeLock,
        },
        { status: 401, headers: NO_STORE },
      );
    }

    if (verifiedVersion === null || accessSessionVersion() !== verifiedVersion) {
      return Response.json(
        { error: "The password changed during login. Please sign in again." },
        { status: 401, headers: NO_STORE },
      );
    }
    recordSuccess(bucket);
    const headers = new Headers(NO_STORE);
    headers.append("Set-Cookie", sessionCookie(await createSessionToken(verifiedVersion), request));
    // Promote this browser to a known device (or refresh its cookie lifetime).
    headers.append("Set-Cookie", loginDeviceCookie(await createLoginDeviceToken(verifiedVersion), request));
    return Response.json({ ok: true }, { status: 200, headers });
  } finally {
    attempt.release();
  }
}

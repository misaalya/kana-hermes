import { readJsonObject, RequestBodyError } from "@/lib/server/request-body";
import { beginLoginAttempt, checkLock, recordFail, recordSuccess } from "@/lib/server/auth/login-limiter";
import { accessSessionVersion, verifyAccessPassword } from "@/lib/server/auth/password-store";
import { createSessionToken, sessionCookie } from "@/lib/server/auth/session";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

// Single shared access password with progressive lockout. There are no user
// accounts to enumerate.
export async function POST(request: Request): Promise<Response> {
  const lock = checkLock();
  if (lock.locked) {
    return Response.json(
      {
        error: `Too many failed attempts. Try again in ${lock.retryAfter}s.`,
        retryAfter: lock.retryAfter,
      },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(lock.retryAfter) } },
    );
  }

  let password: unknown;
  try {
    ({ password } = await readJsonObject(request, 4096));
  } catch (error) {
    return Response.json(
      { error: error instanceof RequestBodyError ? error.message : "A JSON object is required." },
      { status: error instanceof RequestBodyError ? error.status : 400, headers: NO_STORE },
    );
  }
  if (typeof password !== "string" || password.length === 0) {
    return Response.json({ error: "Password is required." }, { status: 400 });
  }

  const attempt = beginLoginAttempt();
  if (attempt.locked) {
    return Response.json(
      { error: "Login is temporarily limited. Please retry shortly.", retryAfter: attempt.retryAfter },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(attempt.retryAfter) } },
    );
  }
  try {
    const verifiedVersion = accessSessionVersion();
    if (!(await verifyAccessPassword(password))) {
      const { remainingBeforeLock } = recordFail();
      const postLock = checkLock();
      if (postLock.locked) {
        return Response.json(
          {
            error: `Too many failed attempts. Try again in ${postLock.retryAfter}s.`,
            retryAfter: postLock.retryAfter,
          },
          { status: 429, headers: { ...NO_STORE, "Retry-After": String(postLock.retryAfter) } },
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
    recordSuccess();
    const token = await createSessionToken(verifiedVersion);
    return Response.json(
      { ok: true },
      { status: 200, headers: { "Set-Cookie": sessionCookie(token, request), ...NO_STORE } },
    );
  } finally {
    attempt.release();
  }
}

import { checkLock, recordFail, recordSuccess } from "@/lib/server/auth/login-limiter";
import { verifyAccessPassword } from "@/lib/server/auth/password-store";
import { createSessionToken, sessionCookie } from "@/lib/server/auth/session";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

// Single shared access password with progressive lockout — the 9Router
// dashboard login model. There are no user accounts to enumerate.
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
    ({ password } = (await request.json()) as { password?: unknown });
  } catch {
    return Response.json({ error: "A request body is required." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length === 0) {
    return Response.json({ error: "Password is required." }, { status: 400 });
  }

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

  recordSuccess();
  const token = await createSessionToken();
  return Response.json(
    { ok: true },
    { status: 200, headers: { "Set-Cookie": sessionCookie(token, request), ...NO_STORE } },
  );
}

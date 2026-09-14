import { isSessionValid } from "@/lib/server/auth/session";
import { RequestBodyError } from "@/lib/server/request-body";

// Shared response conventions for Kana's route handlers. The proxy already
// rejects unauthenticated /api traffic; routes still re-check the session
// (defense in depth) through withSession so that check lives in one place.

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
}

/** Maps body-parsing and validation failures to controlled client errors. */
export function jsonError(error: unknown, fallbackStatus = 400): Response {
  if (error instanceof RequestBodyError) {
    return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : "The request could not be processed." },
    { status: fallbackStatus, headers: NO_STORE },
  );
}

type RouteHandler<Context> = (request: Request, context: Context) => Promise<Response>;

/** Wraps a route handler so it only runs for a valid Kana login session. */
export function withSession<Context = unknown>(
  handler: RouteHandler<Context>,
): (request: Request, context?: Context) => Promise<Response> {
  return async (request, context) => {
    if (!(await isSessionValid(request))) return unauthorized();
    return handler(request, context as Context);
  };
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthEnabled } from "@/lib/server/auth/password-store";
import { verifySessionToken } from "@/lib/server/auth/session";
import { isLoopbackRequest } from "@/lib/server/auth/loopback";

// Auth guard following 9Router's deny-by-default dashboard model:
// - auth APIs needed to bootstrap a session stay public;
// - every other /api/* route requires a valid session cookie once auth is
//   enabled, and spawn-capable local control routes additionally require a
//   loopback peer (with or without auth enabled);
// - pages redirect to /login when a password is configured.

const PUBLIC_API_PATHS = ["/api/auth/login", "/api/auth/logout", "/api/auth/status"];

// Routes that can spawn child processes or read host state — loopback only.
const LOCAL_ONLY_PREFIXES = ["/api/local-runtime/"];

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function forbidden(): NextResponse {
  return NextResponse.json(
    { error: "Local process control accepts loopback requests only." },
    { status: 403 },
  );
}

async function hasValidSession(request: NextRequest): Promise<boolean> {
  return verifySessionToken(request.cookies.get("kana_session")?.value);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authEnabled = isAuthEnabled();

  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API_PATHS.some((path) => pathname === path)) return NextResponse.next();

    if (LOCAL_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
      if (!isLoopbackRequest(request)) return forbidden();
      if (authEnabled && !(await hasValidSession(request))) return unauthorized();
      return NextResponse.next();
    }

    if (!authEnabled) return NextResponse.next();
    if (!(await hasValidSession(request))) return unauthorized();
    return NextResponse.next();
  }

  if (pathname === "/login") {
    // With no password configured the login page has nothing to do.
    return authEnabled ? NextResponse.next() : NextResponse.redirect(new URL("/", request.url));
  }

  if (!authEnabled) return NextResponse.next();
  if (await hasValidSession(request)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    "/((?!_next|manifest\\.webmanifest|icon\\.svg|sw\\.js|favicon\\.ico).*)",
  ],
};

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/server/auth/session";
import { isLoopbackRequest } from "@/lib/server/auth/loopback";

// Auth guard following 9Router's deny-by-default dashboard model:
// - auth APIs needed to bootstrap a session stay public;
// - every other /api/* route requires a valid session cookie. Authentication
//   is always enabled: the password store seeds a default bcrypt hash in
//   SQLite on first use, so there is no unauthenticated mode to warn about;
// - spawn-capable local control routes additionally require a loopback peer;
// - pages redirect to /login.

const PUBLIC_API_PATHS = ["/api/auth/login", "/api/auth/logout", "/api/auth/status"];

// Routes that spawn child processes or read host state — loopback only.
const LOCAL_ONLY_PREFIXES = ["/api/local-runtime/"];

async function hasValidSession(request: NextRequest): Promise<boolean> {
  return verifySessionToken(request.cookies.get("kana_session")?.value);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API_PATHS.some((path) => pathname === path)) {
      return NextResponse.next();
    }

    if (LOCAL_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
      if (!isLoopbackRequest(request)) return forbidden();
      if (!(await hasValidSession(request))) return unauthorized();
      return NextResponse.next();
    }

    if (!(await hasValidSession(request))) return unauthorized();
    return NextResponse.next();
  }

  // The login page must stay reachable without a session — otherwise an
  // unauthenticated visitor to /login is redirected back to /login forever.
  if (pathname === "/login") return NextResponse.next();
  if (await hasValidSession(request)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function forbidden(): NextResponse {
  return NextResponse.json(
    { error: "Local process control accepts loopback requests only." },
    { status: 403 },
  );
}

export const config = {
  matcher: [
    "/((?!_next|manifest\\.webmanifest|icon\\.svg|sw\\.js|favicon\\.ico).*)",
  ],
};

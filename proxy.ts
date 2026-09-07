import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/server/auth/session";

// Deny-by-default authentication guard:
// - auth APIs needed to bootstrap a session stay public;
// - every other /api/* route requires a valid session cookie. That posture
//   also covers process controls on a single-user VPS;
// - the Hermes relay (/api/hermes/*) is authenticated with the session cookie
//   only;
// - pages redirect to /login until a valid session exists.

const PUBLIC_API_PATHS = ["/api/auth/login", "/api/auth/logout", "/api/auth/status"];

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

async function hasValidSession(request: NextRequest): Promise<boolean> {
  return verifySessionToken(request.cookies.get("kana_session")?.value);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API_PATHS.some((path) => pathname === path)) {
      return NextResponse.next();
    }
    if (!(await hasValidSession(request))) return unauthorized();
    return NextResponse.next();
  }

  if (pathname === "/login") {
    return NextResponse.next();
  }

  if (await hasValidSession(request)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    "/((?!_next|manifest\\.webmanifest|icon\\.svg|sw\\.js|favicon\\.ico).*)",
  ],
};

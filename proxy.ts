import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/server/auth/session";
import { checkRequestHost, checkRequestOrigin } from "@/lib/server/request-origin";
import { resolveKanaDeploymentMode } from "@/lib/server/user-config";

// Deny-by-default guard for every request:
// - in local mode, only requests addressed to this computer's loopback names
//   (DNS-rebinding guard, see request-origin.ts);
// - state-changing requests must come from Kana's own origin (CSRF guard,
//   including the public login/logout endpoints);
// - auth APIs needed to bootstrap a session stay public;
// - every other /api/* route requires a valid session cookie, which also
//   covers process controls on a single-user VPS;
// - pages redirect to /login until a valid session exists.

const PUBLIC_API_PATHS = ["/api/auth/login", "/api/auth/logout", "/api/auth/status"];

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

async function hasValidSession(request: NextRequest): Promise<boolean> {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const host = checkRequestHost(request.headers, { local: resolveKanaDeploymentMode().mode === "local" });
  if (!host.allowed) {
    return NextResponse.json(
      {
        error:
          "Kana is in local mode and answers only at localhost, 127.0.0.1, or [::1]. To reach it under another address, add that address to KANA_TRUSTED_ORIGINS or use deployment mode.",
        reason: host.reason,
      },
      { status: 421 },
    );
  }

  const origin = checkRequestOrigin(request);
  if (!origin.allowed) {
    return NextResponse.json(
      { error: "Cross-site request rejected.", reason: origin.reason },
      { status: 403 },
    );
  }

  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API_PATHS.includes(pathname)) return NextResponse.next();
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
    "/((?!_next|manifest\\.webmanifest|icon\\.svg|kana-hermes\\.png|sw\\.js|favicon\\.ico).*)",
  ],
};

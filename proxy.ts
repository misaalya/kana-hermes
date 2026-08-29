import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  isAuthEnabled,
  isInsecureNoAuthMode,
  isNoAuthExplicitlyAllowed,
} from "@/lib/server/auth/password-store";
import { verifySessionToken } from "@/lib/server/auth/session";
import { isLoopbackRequest } from "@/lib/server/auth/loopback";
import { resolveKanaDeploymentMode } from "@/lib/server/user-config";

// Auth guard following 9Router's deny-by-default dashboard model:
// - auth APIs needed to bootstrap a session stay public;
// - every other /api/* route requires a valid session cookie once auth is
//   enabled. That authenticated posture also covers process controls on a
//   single-user VPS, matching the Qwen runtime controls;
// - the Hermes relay (/api/hermes/*) is authenticated with the session cookie
//   only — it runs on the server, so the loopback restriction does not apply;
// - pages redirect to /login when a password is configured.

const PUBLIC_API_PATHS = ["/api/auth/login", "/api/auth/logout", "/api/auth/status"];

const INSECURE_NO_AUTH_HEADER = "x-kana-insecure-no-auth";

let insecureNoAuthWarned = false;

function warnInsecureNoAuthOnce(): void {
  if (insecureNoAuthWarned || !isInsecureNoAuthMode()) return;
  insecureNoAuthWarned = true;
  const acknowledged = isNoAuthExplicitlyAllowed();
  console.warn(
    acknowledged
      ? "[kana] SECURITY WARNING: authentication is disabled by explicit configuration (KANA_ALLOW_NO_AUTH=1). Every visitor can read conversations and drive local process control."
      : "[kana] SECURITY WARNING: production is running WITHOUT authentication (no auth.json, no KANA_ACCESS_PASSWORD). Set KANA_ACCESS_PASSWORD, or set KANA_ALLOW_NO_AUTH=1 to acknowledge an intentionally open instance.",
  );
}

function surfaceInsecureNoAuth(response: NextResponse): NextResponse {
  warnInsecureNoAuthOnce();
  if (isInsecureNoAuthMode()) response.headers.set(INSECURE_NO_AUTH_HEADER, "1");
  return response;
}

function unauthorized(): NextResponse {
  return surfaceInsecureNoAuth(
    NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  );
}

function forbidden(): NextResponse {
  return surfaceInsecureNoAuth(
    NextResponse.json(
      { error: "Passwordless local mode accepts API requests from loopback only." },
      { status: 403 },
    ),
  );
}

function deploymentNeedsAuthentication(): NextResponse {
  return surfaceInsecureNoAuth(
    NextResponse.json(
      { error: "Authentication is required when Kana runs in deployment mode." },
      { status: 403 },
    ),
  );
}

async function hasValidSession(request: NextRequest): Promise<boolean> {
  return verifySessionToken(request.cookies.get("kana_session")?.value);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authEnabled = isAuthEnabled();

  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API_PATHS.some((path) => pathname === path)) {
      return surfaceInsecureNoAuth(NextResponse.next());
    }

    if (
      !authEnabled &&
      resolveKanaDeploymentMode().mode === "deployment"
    ) {
      return deploymentNeedsAuthentication();
    }

    // The npm launcher intentionally runs without a password on loopback for
    // a zero-setup local experience. In that mode, require loopback-shaped
    // Host/Origin evidence as browser-CSRF and DNS-rebinding defense in depth.
    // Binding the launcher to 127.0.0.1 remains the actual network boundary.
    if (!authEnabled && !isLoopbackRequest(request)) return forbidden();

    if (!authEnabled) return surfaceInsecureNoAuth(NextResponse.next());
    if (!(await hasValidSession(request))) return unauthorized();
    return surfaceInsecureNoAuth(NextResponse.next());
  }

  warnInsecureNoAuthOnce();

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

import {
  inspectLocalHermesRuntime,
  startLocalHermesRuntime,
  stopLocalHermesRuntime,
} from "@/lib/server/local-hermes-runtime";
import { isAuthEnabled } from "@/lib/server/auth/password-store";
import { isSessionValid } from "@/lib/server/auth/session";
import { isLoopbackRequest } from "@/lib/server/auth/loopback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local process control for the managed `hermes serve`. Defense in depth: the
// auth proxy already enforces loopback + session for this prefix; these checks
// keep the route honest even without the proxy.
//
// The Hermes session token is NOT part of this API. Kana's server mints and
// holds it; the browser connects through the server-side relay instead.

function forbidden(): Response {
  return Response.json(
    { error: "Local runtime control accepts same-origin loopback requests only." },
    { status: 403 },
  );
}

async function requestAuthorized(request: Request): Promise<boolean> {
  return !isAuthEnabled() || (await isSessionValid(request));
}

export async function GET(request: Request): Promise<Response> {
  if (!isLoopbackRequest(request)) return forbidden();
  if (!(await requestAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const preferredPort = Number(new URL(request.url).searchParams.get("port") ?? "");
  return Response.json(await inspectLocalHermesRuntime(Number.isInteger(preferredPort) && preferredPort > 0 ? preferredPort : undefined), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!isLoopbackRequest(request)) return forbidden();
  if (!(await requestAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const value = (await request.json()) as {
      action?: unknown;
      port?: unknown;
      cwd?: unknown;
    };
    if (value.action === "stop") {
      return Response.json(await stopLocalHermesRuntime());
    }
    if (value.action !== "start" && value.action !== "restart") {
      return Response.json({ error: "Action must be start, restart, or stop." }, { status: 400 });
    }
    if (value.action === "restart") await stopLocalHermesRuntime();
    const status = await startLocalHermesRuntime({
      port: typeof value.port === "number" ? value.port : 9119,
      cwd: typeof value.cwd === "string" ? value.cwd : undefined,
    });
    return Response.json(status);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Hermes control failed." },
      { status: 400 },
    );
  }
}

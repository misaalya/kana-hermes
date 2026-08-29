import {
  inspectLocalHermesRuntime,
  startLocalHermesRuntime,
  stopLocalHermesRuntime,
} from "@/lib/server/local-hermes-runtime";
import { isAuthEnabled } from "@/lib/server/auth/password-store";
import { isSessionValid } from "@/lib/server/auth/session";
import { resolveKanaDeploymentMode } from "@/lib/server/user-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Process control for the managed `hermes serve`. On a local no-auth install,
// the proxy admits only loopback requests. On a VPS, a valid Kana session is
// required, matching the Qwen process-control posture. This lets an
// authenticated remote owner inspect/restart Hermes without opening the route
// to unauthenticated internet traffic.
//
// The Hermes session token is NOT part of this API. Kana's server mints and
// holds it; the browser connects through the server-side relay instead.

async function requestAuthorized(request: Request): Promise<boolean> {
  if (isAuthEnabled()) return isSessionValid(request);
  return resolveKanaDeploymentMode().mode === "local";
}

export async function GET(request: Request): Promise<Response> {
  if (!(await requestAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const preferredPort = Number(new URL(request.url).searchParams.get("port") ?? "");
  return Response.json(await inspectLocalHermesRuntime(Number.isInteger(preferredPort) && preferredPort > 0 ? preferredPort : undefined), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
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

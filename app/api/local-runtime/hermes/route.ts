import {
  inspectLocalHermesRuntime,
  startLocalHermesRuntime,
  stopLocalHermesRuntime,
} from "@/lib/server/local-hermes-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requestAllowed(request: Request): boolean {
  const url = new URL(request.url);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return false;
  const origin = request.headers.get("origin");
  return !origin || origin === url.origin;
}

function forbidden(): Response {
  return Response.json(
    { error: "Local runtime control accepts same-origin loopback requests only." },
    { status: 403 },
  );
}

export async function GET(request: Request): Promise<Response> {
  if (!requestAllowed(request)) return forbidden();
  return Response.json(await inspectLocalHermesRuntime(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!requestAllowed(request)) return forbidden();
  try {
    const value = (await request.json()) as {
      action?: unknown;
      port?: unknown;
      token?: unknown;
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
      token: typeof value.token === "string" ? value.token : "",
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

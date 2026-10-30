import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import { readJsonObject } from "@/lib/server/request-body";
import {
  inspectLocalHermesRuntime,
  restartLocalHermesRuntime,
  startLocalHermesRuntime,
  stopLocalHermesRuntime,
} from "@/lib/server/local-hermes-runtime";
import { hermesGatewayConnected, hermesGatewayRuntimeId } from "@/lib/server/hermes-bridge";
import { configErrorRuntimeStatus, remoteRuntimeStatus } from "@/lib/server/remote-hermes";
import { inspectKanaUserConfig } from "@/lib/server/user-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Process control for the managed `hermes serve` always requires a valid Kana
// session. The Hermes session token is NOT part of this API: Kana's server
// mints and holds it, and the browser connects through the server relay.
// The working folder and executable are server configuration (config.json);
// a browser can choose only the action and, optionally, the port.

const MAX_BODY_BYTES = 1024;

function optionalPort(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1024 || value > 65_535) {
    throw new Error("Hermes port must be an integer between 1024 and 65535.");
  }
  return value;
}

export const GET = withSession(async (request) => {
  const inspection = inspectKanaUserConfig();
  if (inspection.error) {
    return Response.json(configErrorRuntimeStatus(), { headers: NO_STORE });
  }
  const remote = inspection.config.hermes?.remote;
  if (remote) {
    const connected = hermesGatewayConnected("remote");
    return Response.json(
      remoteRuntimeStatus(
        remote,
        connected,
        connected ? hermesGatewayRuntimeId() : null,
      ),
      { headers: NO_STORE },
    );
  }
  const preferredPort = Number(new URL(request.url).searchParams.get("port") ?? "");
  return Response.json(
    await inspectLocalHermesRuntime(
      Number.isInteger(preferredPort) && preferredPort > 0 ? preferredPort : undefined,
    ),
    { headers: NO_STORE },
  );
});

export const POST = withSession(async (request) => {
  try {
    const inspection = inspectKanaUserConfig();
    if (inspection.error) {
      return jsonError(new Error("Kana's config.json could not be read; fix it and reconnect."), 400);
    }
    if (inspection.config.hermes?.remote) {
      return Response.json(
        {
          error:
            "Hermes is configured as remote in config.json; Kana cannot start, restart, or stop it.",
        },
        { status: 400, headers: NO_STORE },
      );
    }
    const value = await readJsonObject(request, MAX_BODY_BYTES);
    if (value.action === "stop") {
      return Response.json(await stopLocalHermesRuntime(), { headers: NO_STORE });
    }
    if (value.action !== "start" && value.action !== "restart") {
      return Response.json(
        { error: "Action must be start, restart, or stop." },
        { status: 400, headers: NO_STORE },
      );
    }
    // A restart keeps the port Hermes is on; only Hermes that Kana started restarts.
    if (value.action === "restart") {
      return Response.json(await restartLocalHermesRuntime(), { headers: NO_STORE });
    }
    return Response.json(await startLocalHermesRuntime({ port: optionalPort(value.port) }), { headers: NO_STORE });
  } catch (error) {
    return jsonError(error);
  }
});

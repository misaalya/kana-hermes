import { existsSync } from "node:fs";
import { isAuthEnabled } from "@/lib/server/auth/password-store";
import { isSessionValid } from "@/lib/server/auth/session";
import {
  ensureKanaUserConfigFile,
  resolveKanaDeploymentMode,
} from "@/lib/server/user-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

async function requestAuthorized(request: Request): Promise<boolean> {
  if (isAuthEnabled()) return isSessionValid(request);
  return resolveKanaDeploymentMode().mode === "local";
}

/** Only exposes the file location, never its potentially sensitive content. */
export async function GET(request: Request): Promise<Response> {
  if (!(await requestAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const configPath = ensureKanaUserConfigFile();
  const deployment = resolveKanaDeploymentMode();
  return Response.json(
    {
      path: configPath,
      exists: existsSync(configPath),
      deploymentMode: deployment.mode,
      deploymentModeSource: deployment.source,
    },
    { headers: NO_STORE },
  );
}

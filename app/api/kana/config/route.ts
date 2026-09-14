import { existsSync } from "node:fs";
import { NO_STORE, withSession } from "@/lib/server/api-response";
import {
  ensureKanaUserConfigFile,
  resolveKanaDeploymentMode,
} from "@/lib/server/user-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only exposes the file location and validity, never its potentially sensitive content. */
export const GET = withSession(async () => {
  const configPath = ensureKanaUserConfigFile();
  const deployment = resolveKanaDeploymentMode();
  return Response.json(
    {
      path: configPath,
      exists: existsSync(configPath),
      deploymentMode: deployment.mode,
      deploymentModeSource: deployment.source,
      configError: deployment.error,
    },
    { headers: NO_STORE },
  );
});

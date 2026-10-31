import { existsSync } from "node:fs";
import { loadGuardrailConfig, summarizeGuardrail } from "@/lib/guardrails/policy";
import { NO_STORE, withSession } from "@/lib/server/api-response";
import {
  ensureKanaUserConfigFile,
  inspectKanaUserConfig,
  resolveKanaDeploymentMode,
} from "@/lib/server/user-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only exposes the file location and validity, never its potentially sensitive content. */
export const GET = withSession(async () => {
  const configPath = ensureKanaUserConfigFile();
  const deployment = resolveKanaDeploymentMode();
  const remoteHermes = Boolean(inspectKanaUserConfig().config.hermes?.remote);
  return Response.json(
    {
      path: configPath,
      exists: existsSync(configPath),
      deploymentMode: deployment.mode,
      deploymentModeSource: deployment.source,
      hermesMode: remoteHermes ? "remote" : "local",
      configError: deployment.error,
      // Whether the prompt guardrail is screening, and how many rules it
      // would send; never the key or the rule text.
      guardrail: summarizeGuardrail(loadGuardrailConfig()),
    },
    { headers: NO_STORE },
  );
});

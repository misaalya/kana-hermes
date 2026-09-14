import { NO_STORE } from "@/lib/server/api-response";
import { isAccessPasswordConfigured } from "@/lib/server/auth/password-store";
import { ensureSessionSecret, isSessionValid } from "@/lib/server/auth/session";
import { resolveKanaDeploymentMode } from "@/lib/server/user-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public: the launcher's readiness probe and the login page's first request.
// It must keep answering even when config.json is invalid, and it never
// reveals anything secret — only whether a password has been set up.
export async function GET(request: Request): Promise<Response> {
  // Bootstrap the per-install signing secret here as a server-side fallback
  // for direct/self-hosted starts.
  ensureSessionSecret();
  const authenticated = await isSessionValid(request);
  const deployment = resolveKanaDeploymentMode();
  return Response.json(
    {
      authEnabled: true,
      authenticated,
      passwordConfigured: isAccessPasswordConfigured(),
      deploymentMode: deployment.mode,
      // Configuration details are for the signed-in owner only.
      ...(authenticated
        ? { deploymentModeSource: deployment.source, configError: deployment.error }
        : {}),
    },
    { headers: NO_STORE },
  );
}

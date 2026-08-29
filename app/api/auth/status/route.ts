import { isInsecureNoAuthMode, isAuthEnabled } from "@/lib/server/auth/password-store";
import { ensureSessionSecret, isSessionValid } from "@/lib/server/auth/session";
import { resolveKanaDeploymentMode } from "@/lib/server/user-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  // This route is the launcher's readiness probe. Bootstrap the per-install
  // signing secret here as a server-side fallback for direct/self-hosted starts.
  ensureSessionSecret();
  const deployment = resolveKanaDeploymentMode();
  return Response.json(
    {
      deploymentMode: deployment.mode,
      deploymentModeSource: deployment.source,
      authEnabled: isAuthEnabled(),
      authenticated: await isSessionValid(request),
      // True only in production with no authentication configured. UI layers
      // may use it to surface the exposure; see docs/SECURITY.md.
      insecureNoAuth: isInsecureNoAuthMode(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

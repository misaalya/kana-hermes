import {
  DEFAULT_ACCESS_PASSWORD,
  isUsingDefaultPassword,
} from "@/lib/server/auth/password-store";
import { ensureSessionSecret, isSessionValid } from "@/lib/server/auth/session";
import { resolveKanaDeploymentMode } from "@/lib/server/user-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  // This route is the launcher's readiness probe. Bootstrap the per-install
  // signing secret here as a server-side fallback for direct/self-hosted starts.
  ensureSessionSecret();
  const deployment = resolveKanaDeploymentMode();
  const usingDefaultPassword = isUsingDefaultPassword();
  return Response.json(
    {
      deploymentMode: deployment.mode,
      deploymentModeSource: deployment.source,
      authEnabled: true,
      authenticated: await isSessionValid(request),
      usingDefaultPassword,
      // The built-in password is intentionally public and shown by the login
      // UI. Stop returning it as soon as a user-owned hash exists.
      defaultPassword: usingDefaultPassword ? DEFAULT_ACCESS_PASSWORD : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

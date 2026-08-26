import { existsSync } from "node:fs";
import { isAuthEnabled } from "@/lib/server/auth/password-store";
import { isSessionValid } from "@/lib/server/auth/session";
import { kanaUserConfigPath } from "@/lib/server/user-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

async function requestAuthorized(request: Request): Promise<boolean> {
  return !isAuthEnabled() || (await isSessionValid(request));
}

/** Only exposes the file location, never its potentially sensitive content. */
export async function GET(request: Request): Promise<Response> {
  if (!(await requestAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const configPath = kanaUserConfigPath();
  return Response.json(
    { path: configPath, exists: existsSync(configPath) },
    { headers: NO_STORE },
  );
}

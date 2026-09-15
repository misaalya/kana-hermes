import { jsonError, NO_STORE, withSession } from "@/lib/server/api-response";
import {
  cancelIrodoriInstall,
  inspectIrodoriInstall,
  installIrodori,
  removeIrodoriInstall,
} from "@/lib/server/irodori/install";
import { readJsonObject } from "@/lib/server/request-body";
import { getConfiguredTtsProvider } from "@/lib/server/tts-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Install state and actions for the local Irodori voice engine. GET is a cheap
// filesystem check that never downloads; POST "install" starts (or joins) the
// background download and returns immediately so the UI can poll progress.

const MAX_BODY_BYTES = 1024;

function localProviderOr409(): Response | null {
  const provider = getConfiguredTtsProvider();
  if (provider.descriptor.capabilities.localInstall) return null;
  return Response.json(
    { error: `${provider.descriptor.name} runs outside Kana; there is nothing to install.`, provider: provider.descriptor },
    { status: 409, headers: NO_STORE },
  );
}

export const GET = withSession(async () => {
  try {
    const provider = getConfiguredTtsProvider();
    if (!provider.descriptor.capabilities.localInstall) {
      return Response.json({ provider: provider.descriptor, install: null }, { headers: NO_STORE });
    }
    return Response.json({ provider: provider.descriptor, install: inspectIrodoriInstall() }, { headers: NO_STORE });
  } catch (error) {
    return jsonError(error, 500);
  }
});

export const POST = withSession(async (request) => {
  try {
    const conflict = localProviderOr409();
    if (conflict) return conflict;
    const { action } = await readJsonObject(request, MAX_BODY_BYTES);
    if (action === "install") {
      const started = installIrodori();
      // Progress is polled through GET; a failure is recorded in the status.
      started.catch(() => undefined);
      // Let pre-flight rejections (unsupported CPU, disk space) surface here.
      const early = await Promise.race([
        started.then(() => null, (error: unknown) => error),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
      ]);
      if (early) {
        return Response.json(
          { error: early instanceof Error ? early.message : String(early), install: inspectIrodoriInstall() },
          { status: 400, headers: NO_STORE },
        );
      }
    } else if (action === "cancel") {
      cancelIrodoriInstall();
    } else if (action === "remove") {
      await removeIrodoriInstall();
    } else {
      return Response.json({ error: "Action must be install, cancel, or remove." }, { status: 400, headers: NO_STORE });
    }
    return Response.json({ install: inspectIrodoriInstall() }, { headers: NO_STORE });
  } catch (error) {
    return jsonError(error);
  }
});

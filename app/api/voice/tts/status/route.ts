import {
  ensureQwen3TTSService,
  inspectLocalQwen3TtsRuntime,
} from "@/lib/server/local-qwen3-tts-runtime";
import { getConfiguredTtsProvider } from "@/lib/server/tts-provider";
import { requireSession } from "@/lib/server/tts-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Non-blocking status for the UI: reports the current runtime state and, when
// `ensure=true` (GET) or on POST, kicks off discovery/spawn through the shared
// single-flight so the status flips to running/external without the request
// blocking on model load.

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  const provider = getConfiguredTtsProvider();
  if (!provider.descriptor.capabilities.runtimeControl) {
    const status = await provider.inspect();
    return Response.json(
      {
        state: status.state === "ready" ? "external" : "failed",
        managed: false,
        port: 0,
        model: status.model,
        device: status.device,
        message: status.message ?? `${provider.descriptor.name} is configured.`,
        provider: provider.descriptor,
        controllable: false,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const ensure = new URL(request.url).searchParams.get("ensure") === "true";
  if (ensure) void ensureQwen3TTSService();
  return Response.json({
    ...await inspectLocalQwen3TtsRuntime(),
    provider: provider.descriptor,
    controllable: true,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

// Convenience: kick a start attempt that returns immediately with the current
// state instead of waiting for readiness. The shared flight never rejects; a
// failed attempt is recorded in the runtime status (state "failed" plus its
// message), so this response and every later poll report the error honestly.
export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  const provider = getConfiguredTtsProvider();
  if (!provider.descriptor.capabilities.runtimeControl) {
    return Response.json(
      { error: `${provider.descriptor.name} has no local runtime to start.` },
      { status: 409 },
    );
  }
  void ensureQwen3TTSService();
  return Response.json({
    ...await inspectLocalQwen3TtsRuntime(),
    provider: provider.descriptor,
    controllable: true,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

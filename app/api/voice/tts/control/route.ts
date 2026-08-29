import {
  ensureQwen3TTSService,
  inspectLocalQwen3TtsRuntime,
  stopLocalQwen3TtsRuntime,
} from "@/lib/server/local-qwen3-tts-runtime";
import { getConfiguredTtsProvider } from "@/lib/server/tts-provider";
import { requireSession } from "@/lib/server/tts-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Status and manual control for the Qwen3-TTS runtime. GET never blocks on a
// spawn; POST start/restart/stop mirrors the Hermes control route semantics.

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  const provider = getConfiguredTtsProvider();
  if (!provider.descriptor.capabilities.runtimeControl) {
    const status = await provider.inspect();
    return Response.json({
      state: status.state === "ready" ? "external" : "failed",
      managed: false,
      port: 0,
      model: status.model,
      device: status.device,
      message: status.message,
      provider: provider.descriptor,
      controllable: false,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
  return Response.json({
    ...await inspectLocalQwen3TtsRuntime(),
    provider: provider.descriptor,
    controllable: true,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  try {
    const provider = getConfiguredTtsProvider();
    if (!provider.descriptor.capabilities.runtimeControl) {
      return Response.json(
        { error: `${provider.descriptor.name} has no local runtime to control.` },
        { status: 409 },
      );
    }
    const value = (await request.json()) as { action?: unknown };
    if (value.action === "stop") {
      return Response.json(await stopLocalQwen3TtsRuntime());
    }
    if (value.action === "restart") await stopLocalQwen3TtsRuntime();
    if (value.action !== "start" && value.action !== "restart") {
      return Response.json(
        { error: "Action must be start, restart, or stop." },
        { status: 400 },
      );
    }
    // Single-flight: shares the exact promise used by speech-time ensure and
    // status kicks, so concurrent starts can never spawn two children.
    const result = await ensureQwen3TTSService();
    if (result.ok) return Response.json(result.status);
    return Response.json(
      { ...result.status, error: result.status.message },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "TTS control failed." },
      { status: 400 },
    );
  }
}

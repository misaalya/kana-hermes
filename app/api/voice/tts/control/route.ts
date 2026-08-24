import {
  inspectLocalQwen3TtsRuntime,
  startLocalQwen3TtsRuntime,
  stopLocalQwen3TtsRuntime,
} from "@/lib/server/local-qwen3-tts-runtime";
import { requireSession } from "@/lib/server/tts-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Status and manual control for the Qwen3-TTS runtime. GET never blocks on a
// spawn; POST start/restart/stop mirrors the Hermes control route semantics.

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(await inspectLocalQwen3TtsRuntime(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  try {
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
    return Response.json(await startLocalQwen3TtsRuntime({}));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "TTS control failed." },
      { status: 400 },
    );
  }
}

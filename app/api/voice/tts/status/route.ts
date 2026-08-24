import {
  ensureQwen3TTSService,
  inspectLocalQwen3TtsRuntime,
  startLocalQwen3TtsRuntime,
} from "@/lib/server/local-qwen3-tts-runtime";
import { requireSession } from "@/lib/server/tts-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Non-blocking status for the UI: reports the current runtime state and, when
// `ensure=true`, kicks off discovery/spawn in the background so the status
// flips to running/external without the request blocking on model load.

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  const ensure = new URL(request.url).searchParams.get("ensure") === "true";
  if (ensure) void ensureQwen3TTSService();
  return Response.json(await inspectLocalQwen3TtsRuntime(), {
    headers: { "Cache-Control": "no-store" },
  });
}

// Convenience: allow a fire-and-forget start request that returns immediately
// with the starting state instead of waiting for readiness.
export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;
  void startLocalQwen3TtsRuntime({}).catch(() => {});
  return Response.json(await inspectLocalQwen3TtsRuntime());
}

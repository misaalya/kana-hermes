import {
  ensureQwen3TTSService,
  inspectLocalQwen3TtsRuntime,
} from "@/lib/server/local-qwen3-tts-runtime";
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
  const ensure = new URL(request.url).searchParams.get("ensure") === "true";
  if (ensure) void ensureQwen3TTSService();
  return Response.json(await inspectLocalQwen3TtsRuntime(), {
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
  void ensureQwen3TTSService();
  return Response.json(await inspectLocalQwen3TtsRuntime(), {
    headers: { "Cache-Control": "no-store" },
  });
}

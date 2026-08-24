import { ensureQwen3TTSService } from "@/lib/server/local-qwen3-tts-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shared plumbing for the /api/voice/tts/* relay routes: session auth (same
// posture as the Hermes RPC relay) and a forward helper that targets the
// discovered/adopted loopback TTS service. The browser never learns the TTS
// base URL; this server process is the only client of the Python service.

export async function requireSession(request: Request): Promise<Response | null> {
  const { isAuthEnabled } = await import("@/lib/server/auth/password-store");
  const { isSessionValid } = await import("@/lib/server/auth/session");
  if (!isAuthEnabled()) return null;
  if (await isSessionValid(request)) return null;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export function ttsServiceUrl(port: number, pathname: string): string {
  return `http://127.0.0.1:${port}${pathname}`;
}

export async function ensureOr503(): Promise<
  { ok: true; port: number } | { ok: false; response: Response }
> {
  const result = await ensureQwen3TTSService();
  if (result.ok) return { ok: true, port: result.port };
  return {
    ok: false,
    response: Response.json(
      {
        error: "The Qwen3-TTS service is unavailable.",
        detail: result.status.message,
        state: result.status.state,
      },
      { status: 503 },
    ),
  };
}

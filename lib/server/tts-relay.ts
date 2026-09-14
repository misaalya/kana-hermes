import { NO_STORE } from "@/lib/server/api-response";
import {
  ensureQwen3TTSService,
  inspectLocalQwen3TtsRuntime,
} from "@/lib/server/local-qwen3-tts-runtime";
import type { ServerTtsProvider } from "@/lib/server/tts-provider/types";

// Shared plumbing for the /api/voice/tts/* relay routes: target resolution for
// the discovered/adopted loopback TTS service and response relaying. The
// browser never learns the TTS base URL; this server process is the only
// client of the Python service. Session checks use withSession.

export function ttsServiceUrl(port: number, pathname: string): string {
  return `http://127.0.0.1:${port}${pathname}`;
}

export async function ensureOr503(): Promise<
  { ok: true; port: number } | { ok: false; response: Response }
> {
  const result = await ensureQwen3TTSService();
  if (result.ok) return { ok: true, port: result.status.port };
  return {
    ok: false,
    response: Response.json(
      {
        error: "The Qwen3-TTS service is unavailable.",
        detail: result.status.message,
        state: result.status.state,
      },
      { status: 503, headers: NO_STORE },
    ),
  };
}

// Probe-only resolution for routes that must never spawn the Python service
// (health, setup, cancel): adopt an already-running instance or report the
// honest runtime state instead of triggering a cold start.
export async function probeOnlyPortOr503(): Promise<
  { ok: true; port: number } | { ok: false; response: Response }
> {
  const status = await inspectLocalQwen3TtsRuntime();
  if (status.state === "running" || status.state === "external") {
    return { ok: true, port: status.port };
  }
  return {
    ok: false,
    response: Response.json(
      {
        error: "The Qwen3-TTS service is not running.",
        detail: status.message,
        state: status.state,
      },
      { status: 503, headers: NO_STORE },
    ),
  };
}

/** Relay an upstream service response (status, body, content type) to the browser. */
export async function relayUpstream(
  url: string,
  init: RequestInit & { timeoutMs: number; failure: string },
): Promise<Response> {
  const { timeoutMs, failure, ...requestInit } = init;
  try {
    const upstream = await fetch(url, {
      cache: "no-store",
      ...requestInit,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        ...NO_STORE,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? `${failure}: ${error.message}` : `${failure}.` },
      { status: 502, headers: NO_STORE },
    );
  }
}

/** Runtime-status shape for providers Kana does not run itself. */
export async function uncontrolledProviderStatus(provider: ServerTtsProvider): Promise<Response> {
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
    { headers: NO_STORE },
  );
}

export function providerConflict(message: string): Response {
  return Response.json({ error: message }, { status: 409, headers: NO_STORE });
}

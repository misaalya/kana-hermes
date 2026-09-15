import { TtsProviderError, type ServerTtsProvider } from "./types";

type ActiveRequest = { provider: ServerTtsProvider; controller: AbortController };
const key = Symbol.for("kana.ttsRequests");
const shared = globalThis as typeof globalThis & { [key]?: Map<string, ActiveRequest> };
const requests = shared[key] ??= new Map<string, ActiveRequest>();

/** Cancellation follows the request's original provider even if config changes. */
export function trackTtsRequest(id: string | undefined, provider: ServerTtsProvider) {
  if (id && requests.has(id)) throw new TtsProviderError("This speech request is already running.", 409);
  const entry = { provider, controller: new AbortController() };
  if (id) requests.set(id, entry);
  return {
    signal: entry.controller.signal,
    finish: () => { if (id && requests.get(id) === entry) requests.delete(id); },
  };
}

export async function cancelTtsRequest(id: string, signal: AbortSignal): Promise<boolean> {
  const entry = requests.get(id);
  if (!entry) return false;
  entry.controller.abort();
  if (entry.provider.cancel) await entry.provider.cancel(id, signal);
  return true;
}

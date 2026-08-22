export type SanitizedHermesEndpoint = {
  endpoint: string;
  embeddedToken: string;
};

/**
 * Keeps credentials out of persistent endpoint settings. Browser WebSockets
 * still send the tab-scoped token as a query parameter at connection time
 * because the WebSocket constructor cannot set an Authorization header.
 */
export function sanitizeHermesWebSocketEndpoint(
  value: string,
): SanitizedHermesEndpoint {
  try {
    const url = new URL(value);
    if (!/^wss?:$/.test(url.protocol) || url.username || url.password) {
      throw new Error();
    }
    const embeddedToken =
      url.searchParams.get("token") ?? url.searchParams.get("ticket") ?? "";
    url.searchParams.delete("token");
    url.searchParams.delete("ticket");
    url.hash = "";
    return { endpoint: url.toString(), embeddedToken };
  } catch {
    throw new Error(
      "Hermes endpoint must be a ws:// or wss:// URL without embedded credentials.",
    );
  }
}

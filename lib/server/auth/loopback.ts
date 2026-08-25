import { createHash, timingSafeEqual } from "node:crypto";

// Loopback peer checks shared by the auth proxy guard and route handlers.
// Host/Origin headers are attacker-controllable in general, but combined they
// block remote pages from driving spawn-capable local endpoints (CSRF), which
// is the threat that matters for Kana's local process control.

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export const TRUSTED_PROXY_HEADER = "x-kana-trusted-proxy";

// Accepts a Host header or URL hostname. Splitting on the first colon only
// works for IPv4 and would reduce every IPv6 form to "", so handle bracketed
// and IPv4-mapped forms explicitly.
export function isLoopbackHostname(value: string | null | undefined): boolean {
  if (!value) return false;
  let name = String(value).trim().toLowerCase();
  if (name.startsWith("[")) {
    const end = name.indexOf("]");
    if (end === -1) return false;
    name = name.slice(1, end);
  } else if (name.includes(":") && name.indexOf(":") === name.lastIndexOf(":")) {
    name = name.slice(0, name.indexOf(":"));
  }
  if (name.startsWith("::ffff:")) name = name.slice(7);
  return LOOPBACK_HOSTS.has(name);
}

export function isLoopbackPeer(headers: {
  host?: string | null;
  origin?: string | null;
}): boolean {
  // Pass the full Host header; isLoopbackHostname strips brackets/ports itself.
  if (!isLoopbackHostname(headers.host ?? null)) return false;
  const origin = headers.origin ?? null;
  if (!origin) return true;
  try {
    return isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

// Constant-time comparison of the shared proxy secret. Both sides are hashed
// first so timingSafeEqual always receives equal-length buffers.
export function trustedProxySecretMatches(
  headerValue: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  const expected = secret?.trim();
  if (!expected || !headerValue) return false;
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(headerValue).digest();
  return timingSafeEqual(left, right);
}

export function isLoopbackRequest(request: Request): boolean {
  const secret = process.env.KANA_TRUSTED_PROXY_SECRET;
  if (secret?.trim()) {
    // Shared-secret model: only requests presenting the exact configured
    // header value are trusted. Hostname evidence is deliberately ignored —
    // a reverse proxy forwards whatever Host the client sent, so "Host:
    // 127.0.0.1" from the internet must not unlock local-only routes.
    return trustedProxySecretMatches(request.headers.get(TRUSTED_PROXY_HEADER), secret);
  }

  // No secret configured: the client-controllable header is ignored entirely
  // and only direct-loopback hostname evidence grants local trust.
  return isLoopbackPeer({
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
  });
}

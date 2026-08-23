// Loopback peer checks shared by the auth proxy guard and route handlers.
// Host/Origin headers are attacker-controllable in general, but combined they
// block remote pages from driving spawn-capable local endpoints (CSRF), which
// is the threat that matters for Kana's local process control.

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

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

export function isLoopbackRequest(request: Request): boolean {
  // Pass the full Host header; isLoopbackHostname strips brackets/ports itself.
  if (!isLoopbackHostname(request.headers.get("host"))) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

// Cross-site request forgery guard for state-changing requests.
//
// SameSite=Lax cookies alone are not enough for Kana: "same-site" ignores the
// port, so any other app on localhost (or a sibling subdomain of a VPS domain)
// can POST to Kana with the owner's cookie. Browsers attach an Origin header to
// every cross-origin and same-origin POST/PUT/PATCH/DELETE, and a page cannot
// forge Origin or add X-Forwarded-Host without a CORS preflight Kana never
// grants. Comparing Origin with the host the request was addressed to is
// therefore sufficient.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type OriginCheck = { allowed: true } | { allowed: false; reason: string };

function normalizeHost(value: string | null | undefined): string | null {
  const first = value?.split(",")[0]?.trim().toLowerCase();
  return first ? first : null;
}

function defaultPort(protocol: string): string {
  return protocol === "https:" ? "443" : protocol === "http:" ? "80" : "";
}

/** host[:port] with the scheme's default port removed, for comparison. */
function canonicalHost(host: string, protocol: string): string {
  const port = defaultPort(protocol);
  return port && host.endsWith(`:${port}`) ? host.slice(0, -(port.length + 1)) : host;
}

/** Extra allowed origins for unusual proxies, e.g. KANA_TRUSTED_ORIGINS=https://kana.example. */
export function trustedOriginsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.KANA_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        return [new URL(value).origin.toLowerCase()];
      } catch {
        return [];
      }
    });
}

export function checkRequestOrigin(
  input: {
    method: string;
    headers: Headers;
  },
  trustedOrigins: readonly string[] = trustedOriginsFromEnv(),
): OriginCheck {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return { allowed: true };

  const origin = input.headers.get("origin");
  if (!origin) {
    // Fetch-metadata is the fallback signal for browsers that omit Origin.
    const site = input.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") {
      return { allowed: false, reason: `cross-site request (${site})` };
    }
    // No browser metadata at all: a non-browser client (curl, the launcher,
    // scripts). It cannot carry a victim's cookies, so CSRF does not apply.
    return { allowed: true };
  }
  if (origin === "null") return { allowed: false, reason: "opaque origin" };

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return { allowed: false, reason: "malformed origin" };
  }
  if (trustedOrigins.includes(parsed.origin.toLowerCase())) return { allowed: true };

  const originHost = canonicalHost(parsed.host.toLowerCase(), parsed.protocol);
  const candidates = [
    normalizeHost(input.headers.get("host")),
    // Reverse proxies that rewrite Host usually forward the public one here.
    // Nginx must pass `$http_host`: `$host` drops a non-default port.
    normalizeHost(input.headers.get("x-forwarded-host")),
  ].filter((value): value is string => Boolean(value));

  const matches = candidates.some(
    (host) =>
      canonicalHost(host, parsed.protocol) === originHost ||
      // A TLS-terminating proxy may forward Host with the public :443/:80.
      canonicalHost(host, "https:") === originHost ||
      canonicalHost(host, "http:") === originHost,
  );
  return matches
    ? { allowed: true }
    : { allowed: false, reason: `origin ${parsed.origin} does not match this server` };
}

// DNS-rebinding guard for local mode.
//
// A local Kana listens only on this computer, yet a web page can still reach
// it: the attacker points their own domain at 127.0.0.1 (DNS rebinding), and
// the browser then sends that domain as Host and as Origin. They match, so
// the check above lets the page try passwords and, with the right one, drive
// Hermes. A browser never resolves the loopback names below through DNS, so
// in local mode Kana answers only to those, plus hosts the operator lists.
// Deployment mode answers to any name: it is reached by its public host.

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The name part of a Host value (no port), lowercased; IPv6 keeps brackets. */
function hostName(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) return value.slice(0, value.indexOf("]") + 1);
  const colon = value.lastIndexOf(":");
  return colon === -1 ? value : value.slice(0, colon);
}

function isLoopbackName(name: string): boolean {
  return LOOPBACK_NAMES.has(name) || name.endsWith(".localhost") || /^127(?:\.\d{1,3}){3}$/.test(name);
}

/** Host names from KANA_TRUSTED_ORIGINS and, for `next dev`, KANA_DEV_ALLOWED_ORIGINS (`*.suffix` allowed). */
export function allowedHostsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const hosts = trustedOriginsFromEnv(env).map((origin) => hostName(new URL(origin).host));
  for (const value of (env.KANA_DEV_ALLOWED_ORIGINS ?? "").split(",")) {
    const entry = value.trim().toLowerCase();
    if (!entry) continue;
    try {
      hosts.push(entry.includes("://") ? hostName(new URL(entry).host) : hostName(entry));
    } catch {
      // Not a host; ignored like an invalid trusted origin.
    }
  }
  return hosts;
}

export function checkRequestHost(
  headers: Headers,
  { local, allowedHosts = allowedHostsFromEnv() }: { local: boolean; allowedHosts?: readonly string[] },
): OriginCheck {
  if (!local) return { allowed: true };
  const host = headers.get("host");
  if (!host) return { allowed: false, reason: "missing Host header" };
  const name = hostName(host);
  const listed = allowedHosts.some((allowed) =>
    allowed.startsWith("*.") ? name.endsWith(allowed.slice(1)) : allowed === name,
  );
  return isLoopbackName(name) || listed
    ? { allowed: true }
    : { allowed: false, reason: `host ${name} is not this computer` };
}

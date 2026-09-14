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

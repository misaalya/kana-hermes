# Kana local security model

Kana displays sensitive agent activity in a browser, so “localhost” is not
treated as automatically trusted.

## Trust boundaries

- Hermes and Qwen are separate, user-controlled local services.
- Hermes is the only agent and executes every tool. Kana does not execute shell
  commands, filesystem actions, MCP calls, or model requests itself.
- The browser stores conversations, non-secret preferences, and imported
  avatar packages. The Hermes token is tab-scoped session storage only.
- Remote Live2D model URLs are untrusted data. Cubism Core is executable and is
  therefore restricted to Live2D's official HTTPS SDK path.

## Threat checklist

| Surface | Control |
| --- | --- |
| WebSocket origin | Hermes validates browser origin; Kana documents that hostname forms must match |
| Hermes credential | Removed from persistent preferences and diagnostics; legacy URL/query tokens migrate to tab storage |
| Protected input | Password/secret fields are uncontrolled, ephemeral, and submitted directly to Hermes |
| Qwen CORS | Service defaults to `127.0.0.1`/`localhost`, no credentials, and a small method/header allow-list |
| Rendered text | React text nodes render transcript/tool status; Kana does not inject response HTML or Markdown |
| Cubism Core | Only `https://cubism.live2d.com/sdk-web/cubismcore/*.js` is executable |
| Remote models | HTTPS or localhost HTTP `.model3.json`, no embedded credentials; CSP permits data fetch but not remote scripts |
| Folder import | Relative paths, duplicate paths, JSON, required assets, and folder escapes are validated before IndexedDB write |
| Diagnostics | Endpoint queries and common token/password/secret forms are redacted; content and protected input are omitted |
| Local-only routes | Trusted via shared secret (`KANA_TRUSTED_PROXY_SECRET` + `X-Kana-Trusted-Proxy` header, timing-safe compare) or direct loopback Host/Origin evidence; the bare `x-kana-trusted-proxy: 1` marker is no longer honored |
| Backup | Versioned and size-limited; parser validates records; tokens and imported avatar assets are excluded |
| Offline cache | Service worker handles same-origin navigation/static assets only and explicitly ignores `/api` plus all cross-origin Hermes/Qwen/model traffic |
| Framing/injection | CSP blocks objects and framing; `nosniff`, no-referrer, and restrictive permissions headers are set |

## Reverse proxy (VPS)

When Kana runs behind nginx on a VPS, configure the proxy headers explicitly:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Shared-secret trust for local-only routes (/api/local-runtime/*).
    # Set the SAME value as the server's KANA_TRUSTED_PROXY_SECRET.
    proxy_set_header X-Kana-Trusted-Proxy "<same value as KANA_TRUSTED_PROXY_SECRET>";
}
```

Trust model for spawn-capable local-only routes:

- **`KANA_TRUSTED_PROXY_SECRET` set (recommended on a VPS):** a request is
  trusted only when its `X-Kana-Trusted-Proxy` header equals the configured
  secret (compared with `timingSafeEqual`). Hostname evidence is ignored,
  because nginx forwards whatever `Host` the client sent — a remote caller
  sending `Host: 127.0.0.1` must not unlock these routes.
- **Secret unset:** the header is ignored entirely and only direct-loopback
  `Host`/`Origin` pairs are trusted.

Never leave an old plain marker such as `proxy_set_header X-Kana-Trusted-Proxy
"1";` in place, and never forward a client-supplied value of this header:
either set it to the shared secret or blank it with `proxy_set_header
X-Kana-Trusted-Proxy "";`. A spoofable trusted-proxy header would let remote
callers reach Hermes process control.

Forwarding `X-Forwarded-Proto $scheme` keeps session cookies `Secure`
automatically; if your proxy cannot forward it, set `AUTH_COOKIE_SECURE=true`.

## Production without authentication

Production boots with authentication disabled (no `auth.json`, no
`KANA_ACCESS_PASSWORD`) only when `KANA_ALLOW_NO_AUTH=1` acknowledges it; the
server logs a loud warning either way and surfaces the state as
`insecureNoAuth: true` in `/api/auth/status` plus an
`x-kana-insecure-no-auth: 1` response header from the auth guard. UI layers may
use that flag to warn the operator; the flag stays `true` even while the opt-out
is acknowledged because the exposure itself does not disappear.

## CSP rationale

The app remains statically renderable and uses a header CSP. Next/React require
inline styles/scripts in this packaging mode; development additionally needs
`unsafe-eval`. Remote JavaScript is allowed only from Live2D's official Core
host. `connect-src` permits HTTPS model data plus loopback HTTP/WebSocket for
Hermes and Qwen. Insecure arbitrary remote HTTP and remote WebSocket origins
are not allowed.

The policy intentionally does not use `upgrade-insecure-requests`, because it
would break loopback `http://` Qwen and `ws://` Hermes services.

## Offline shell

The production service worker caches the statically rendered root shell,
manifest, icon, and same-origin Next static assets. It never stores transcript
data, IndexedDB records, credentials, protected input, external Live2D assets,
Hermes WebSockets, Qwen requests, or application API responses. Offline mode
therefore restores the UI and CSS fallback only; it does not imitate a working
agent or voice service.

## Backup and removal

Settings → Local data backup downloads conversations and non-secret
preferences. Restore merges matching IDs and does not delete unmatched local
history. Imported Live2D files must be moved separately according to their
license. Clearing this site's browser storage removes Kana-local data; it does
not alter Hermes sessions, configuration, source, or installation.

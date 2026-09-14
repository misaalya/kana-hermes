# Kana local security model

Kana displays sensitive agent activity in a browser, so “localhost” is not
treated as automatically trusted.

## Trust boundaries

- Hermes and the selected TTS provider are separate, user-controlled services.
- Hermes is the only agent and executes every tool. Kana does not execute shell
  commands, filesystem actions, MCP calls, or model requests itself.
- The browser stores non-secret preferences and imported avatar packages.
  Hermes owns conversation transcripts, while Kana's server keeps the Hermes
  session token only in process memory.
- Remote Live2D model URLs are untrusted data. Cubism Core is executable and is
  therefore restricted to Live2D's official HTTPS SDK path.

## Threat checklist

| Surface | Control |
| --- | --- |
| WebSocket origin | Hermes validates browser origin; Kana documents that hostname forms must match |
| Hermes credential | Minted/discovered and held by Kana's server process; never returned to the browser, preferences, diagnostics, URLs, or backups |
| TTS API key | User-supplied in owner-only server `config.json`; attached only to the upstream request and excluded from browser status, preferences, diagnostics, and backups |
| TTS response abuse | Speech text and provider error bodies are bounded, non-audio/empty responses are rejected, and local or external audio is capped at 64 MB before browser buffering |
| Protected input | Password/secret fields are uncontrolled, ephemeral, and submitted directly to Hermes |
| Qwen CORS | Service defaults to `127.0.0.1`/`localhost`, no credentials, and a small method/header allow-list |
| Rendered text | React text nodes render transcript/tool status; Kana does not inject response HTML or Markdown |
| Cubism Core | Only `https://cubism.live2d.com/sdk-web/cubismcore/*.js` is executable |
| Remote models | HTTPS or localhost HTTP `.model3.json`, no embedded credentials; CSP permits data fetch but not remote scripts |
| Folder import | Relative paths, duplicate paths, JSON, required assets, and folder escapes are validated before IndexedDB write |
| Diagnostics | Endpoint queries and common token/password/secret forms are redacted; content and protected input are omitted |
| Kana access | Every installation requires a signed Kana session. There is no default password: login is refused until the owner runs `kana password` on the server, so nobody can claim a fresh VPS over the web |
| Password storage | scrypt (node:crypto) in `appstate.db`; bcrypt hashes from older releases still verify and are upgraded to scrypt on the next successful login |
| Login lockout | Not keyed by IP (CGNAT). Browsers that signed in before carry a signed device cookie with their own bucket; all other attempts share a strict progressive bucket, so guessing cannot lock the owner's devices out. One verification per bucket runs at a time |
| Cross-site requests | The proxy rejects POST/PUT/PATCH/DELETE whose `Origin` does not match the request host (or `Sec-Fetch-Site` says cross-site). SameSite=Lax alone would allow other apps on the same host with a different port |
| Logout | Revokes the presented session token server-side until its expiry, not just the cookie |
| Request bodies | Every route reads a bounded body (see `lib/limits.ts`); oversized requests are cancelled before decoding. Next's proxy buffer and the Nginx `client_max_body_size` are derived from the same limit, because Next truncates longer bodies silently |
| Event streams | Abort/cancel releases subscriptions and timers, slow readers are disconnected at a 16 MiB queue limit, and session validity is rechecked every 25 seconds |
| Backup | Versioned and size-limited; parser validates records; tokens and imported avatar assets are excluded |
| Offline cache | Service worker handles same-origin navigation/static assets only and explicitly ignores `/api` plus all cross-origin Hermes/Qwen/model traffic |
| Framing/injection | CSP blocks objects and framing; `nosniff`, no-referrer, and restrictive permissions headers are set |

## Reverse proxy (VPS)

When Kana runs behind nginx on a VPS, configure the proxy headers explicitly:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`Host $http_host` matters for the cross-site request guard: Kana compares the
browser's `Origin` with the host the request was addressed to. Use
`$http_host`, not `$host`: `$host` drops the port, so on a public port other
than 80/443 (for example `listen 8443 ssl`) every sign-in and other write would
be rejected as cross-site. A proxy that
rewrites `Host` must forward the public one as `X-Forwarded-Host`, or list the
public origin in `KANA_TRUSTED_ORIGINS` (comma-separated).

Forwarding `X-Forwarded-Proto $scheme` keeps session cookies `Secure`
automatically; if your proxy cannot forward it, set `AUTH_COOKIE_SECURE=true`.
A valid Kana session authorizes the same process controls for Hermes and Qwen.

## Access password

Authentication is always enabled and there is no built-in password. The first
password is created on the machine running Kana:

- `kana` and `kana serve` ask for it on first start in an interactive terminal;
- `kana password` sets or changes it at any time (`--stdin` for automation);
- a source checkout uses `npm run password`, a standalone deployment
  `node bin/kana.mjs password`.

Until then the login page explains this and every login returns 503. Setting
the first password over HTTP was deliberately not added: on a new VPS whoever
reaches the page first would own the agent.

Kana stores only an scrypt hash with a session version in the `auth.password`
row of `$KANA_DATA_DIR/appstate.db`. Password changes (from Settings or the
CLI) store a new session version, so previous tokens stop authorizing requests;
the browser making a Settings change receives a replacement token. Existing
event streams stop on their next authorization heartbeat (within 25 seconds).
A login already verifying an old password cannot mint a token for the new
version. Session verification requires HS256, issued-at/expiry claims, and an
authenticated payload. Passwords are 8–256 characters without leading or
trailing whitespace; scrypt does not truncate them.

Lockout state lives in server memory and resets on restart. A brand-new
browser that has never signed in shares the unknown-client bucket; during an
active guessing attack it may have to wait, while previously used browsers are
unaffected.

## CSP rationale

The app remains statically renderable and uses a header CSP. Next/React require
inline styles/scripts in this packaging mode (a nonce-based policy would force
dynamic rendering and break the cached offline shell); development additionally
needs `unsafe-eval`. Remote JavaScript is allowed only from Live2D's official
Core host. The browser reaches Hermes and Qwen only through Kana's same-origin
relay; `connect-src`/`img-src` still permit HTTPS and loopback HTTP because
users may load Live2D models from a hosted URL or a local static server.
Insecure arbitrary remote HTTP and remote WebSocket origins are not allowed.

The policy intentionally does not use `upgrade-insecure-requests`, because it
would break loopback `http://` Live2D model hosting.

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

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
| Local passwordless mode | Direct loopback Host/Origin evidence is required. Explicit deployment mode requires an authenticated Kana session for Hermes and Qwen process controls |
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
    proxy_set_header X-Kana-Trusted-Proxy "";
}
```

Set `KANA_DEPLOYMENT_MODE=deployment` and configure Kana authentication. A
valid Kana session then authorizes the same process controls for Hermes and
Qwen. Never forward a client-supplied `X-Kana-Trusted-Proxy` value; the header
is only retained for deliberately proxied local/no-auth compatibility and is
not needed by an authenticated deployment.

Forwarding `X-Forwarded-Proto $scheme` keeps session cookies `Secure`
automatically; if your proxy cannot forward it, set `AUTH_COOKIE_SECURE=true`.

## Production without authentication

The global `kana` launcher deliberately binds to `127.0.0.1` and acknowledges
passwordless local-only use with `KANA_ALLOW_NO_AUTH=1`. In this mode the auth
guard also rejects API requests whose Host/Origin is not loopback, protecting
the local browser flow from cross-origin requests. This is defense in depth;
the loopback network bind is what prevents remote clients from reaching it.

Do not use passwordless mode for a VPS, shared machine, container port publish,
or reverse proxy. Those deployments must set `deployment.mode` to
`"deployment"` in `$KANA_DATA_DIR/config.json` (or use
`KANA_DEPLOYMENT_MODE=deployment`) and configure `KANA_ACCESS_PASSWORD` or an
existing `auth.json`. Production or explicit deployment mode without
authentication logs a warning and surfaces the state as
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

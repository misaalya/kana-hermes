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
| Kana access | Every installation requires a signed Kana session. Fresh installs show the documented default password; a user-owned bcrypt hash takes precedence after an optional change |
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
}
```

Set `KANA_DEPLOYMENT_MODE=deployment`. A valid Kana session authorizes the
same process controls for Hermes and Qwen.

Forwarding `X-Forwarded-Proto $scheme` keeps session cookies `Secure`
automatically; if your proxy cannot forward it, set `AUTH_COOKIE_SECURE=true`.

## Default access password

Authentication is always enabled. Fresh npm installs, source builds, and
development servers use `chankana123`; the login screen displays it so the
first run has no terminal configuration step. Changing it is optional. When a
user changes it in Settings, Kana stores only a bcrypt hash in the
`auth.password` row of `$KANA_DATA_DIR/appstate.db`, stops displaying the
built-in password, and no longer accepts it. Upgrades from the older
`auth.json` layout migrate that hash into SQLite before removing the legacy
file.

The built-in value is public product behavior, not a private deployment
secret. A public or shared installation should still use HTTPS and may replace
the password from Settings, but Kana does not force that change.

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

# Kana security model

Kana displays sensitive agent activity in a browser, so "localhost" is not
automatically trusted. This covers the trust boundaries and enforced controls.

**Read when:** you are deploying Kana, reviewing its threat model, or placing it behind a reverse proxy.
**Truth in code:** `proxy.ts`, `lib/server/request-origin.ts`, `lib/server/auth/`, `lib/server/media-links.ts`, `lib/guardrails/policy.ts`

## Trust boundaries

- Hermes and the selected TTS provider are separate, user-controlled services.
  Hermes is the only agent and executes every tool; Kana runs no shell command,
  filesystem action, MCP call, or model request itself.
- The browser holds non-secret preferences and imported avatar packages, and
  reaches Hermes and the voice engine only through Kana's same-origin relay.
  Hermes owns conversation transcripts; Kana's server mints or discovers the
  Hermes session token, keeps it in process memory, and never returns it to the
  browser, preferences, diagnostics, URLs, or backups.
- Remote Live2D model URLs are untrusted data. Cubism Core is executable, and
  is restricted to Live2D's official HTTPS SDK path. Files Hermes delivers are
  untrusted input and are treated in Delivered files below.
- The optional prompt guardrail is a separate service as well. When the owner
  sets a TypeSafe key, the text of each screened turn is sent to TypeSafe's API,
  and the probability it returns is thresholded in Kana's own code. The key stays
  in `config.json` and the server process.

## Threat checklist

| Surface | Control |
| --- | --- |
| Kana access | Deny-by-default proxy: every `/api/*` route needs a signed session cookie except `/api/auth/login`, `/api/auth/logout`, and `/api/auth/status`; pages redirect to `/login` |
| Session token | HS256 JWT in an HttpOnly, SameSite=Lax cookie valid for 24 hours; the signing secret is `KANA_JWT_SECRET` or an owner-only generated file |
| Cross-site requests | State-changing requests are rejected unless `Origin` matches the addressed host (or `Sec-Fetch-Site` is same-origin). SameSite=Lax alone allows another app on the same host with a different port |
| DNS rebinding | In local mode the proxy answers only to `localhost`, `*.localhost`, `[::1]`, and the `127.*` addresses; every other Host gets 421. A rebound page sends a matching Host and Origin, which the cross-site check alone would accept |
| Login lockout | Not keyed by IP. A browser that signed in before carries a signed device cookie and has its own bucket; all other attempts share one strict progressive bucket, so guessing cannot lock the owner's devices out. One password check runs per bucket at a time |
| Delivered files | `MEDIA:` paths become signed links only for regular files outside system paths, home credential folders and files, Hermes's secrets, and Kana's data root; the file is re-checked on every request |
| Protected input | Password and secret fields are uncontrolled, ephemeral, sent directly to Hermes, and never added to Kana history, activity details, preferences, or local storage |
| Prompt guardrail | Optional and off without an owner-set key. The owner's rules and key live in `config.json`, which Kana has no writer for, and the key never reaches the browser. A rule that fires, or a check that could not run, refuses the turn before it reaches Hermes |
| Local voice engine | No listening service: each utterance is a short-lived child process with a minimal environment; every downloaded artifact is pinned by size and SHA-256 and verified before it is unpacked or run |
| Hermes process | `hermes serve` started by Kana listens on 127.0.0.1 with a minted token and inherits no `KANA_*` setting, so `KANA_JWT_SECRET` never reaches the commands Hermes runs |

## Access password

Authentication is always enabled. There is no default password and no web flow
that creates one: on a new VPS, whoever reaches the page first must not own the
agent. Until a password exists, every login returns 503 and the login page shows
the one command that sets it.

- `kana` and `kana serve` ask for a password on first start in an interactive
  terminal; `kana password` sets or changes it at any time, with `--stdin` for
  automation (`printf '%s\n' "$PASSWORD" | kana password --stdin`); a source
  checkout uses `npm run password` and a standalone deployment uses
  `node bin/kana.mjs password`.

The launcher passes the applicable command as `KANA_PASSWORD_COMMAND`;
`/api/auth/status` names it only while no password is set, and only one of those
three values. Passwords are 8–256 characters without leading or trailing space.

Kana stores a scrypt hash with a session version in the `auth.password` row of
`$KANA_DATA_DIR/appstate.db`. Bcrypt hashes from older releases still verify and
are upgraded to scrypt on the next successful login, keeping the session version
so nobody is signed out.

A password change stores a new session version, so every earlier token stops
authorizing requests and the changing browser receives a replacement. The
current-password check counts against the same login limiter bucket, and a login
still verifying the old password cannot mint a token for the new version. An SSE
stream revalidates the session on its 25-second heartbeat, so a stream whose
authorization lapses ends. Lockout state lives in server memory and resets on
restart; a browser that never signed in shares the unknown-client bucket, while
previously used browsers keep their own.

## Content security

`next.config.ts` sets the policy as headers so the app stays statically
renderable and the offline shell cacheable; inline styles and scripts are
required in this packaging mode (`unsafe-eval` additionally in development).
Remote JavaScript is allowed only from Live2D's official Core host. HTTPS and
loopback HTTP are permitted for `connect-src` and `img-src` because a user may
load a hosted or locally served Live2D model; arbitrary remote HTTP and remote
WebSocket origins are not. `object-src 'none'`, `frame-ancestors 'none'`, and
`X-Frame-Options: DENY` block plugin content and framing. `Referrer-Policy:
no-referrer` and `X-Content-Type-Options: nosniff` are set on every response,
and `Permissions-Policy` denies camera and geolocation and restricts microphone
to Kana's own origin. The policy deliberately omits `upgrade-insecure-requests`,
which would break loopback `http://` Live2D model hosting.

A file from `/api/media` is served as a sandboxed document with its own policy
(`default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline';
sandbox`), so an SVG or HTML file opened on its own can never run script as Kana.
The route requires a session, and responses are `private, no-cache` with range
support and ETag revalidation.

## Prompt guardrail

The guardrail is a data-sharing decision as much as a control. When the owner
sets `guardrails.apiKey`, the text of every screened turn — a chat message, a
slash command, or `/steer` — is sent to `https://api.typesafe.ai/v1/systemone`
for evaluation, so that text leaves the machine for a third party. With no key,
or a key and no rules, nothing is sent and the layer costs nothing.

The rules and the key live in `config.json`, which Kana creates once, owner-only,
and never rewrites; no route, setting, or browser request can change a rule or
read the key, and `GET /api/kana/config` reports only whether the layer is on and
how many rules it would send. A rule that fires, or a check that cannot run while
`whenUnavailable` is `"block"`, refuses the turn before it reaches the bridge, so
Hermes never sees it and never stores it.

The guardrail is not a sandbox. It reads the text a turn starts with, not the
contents of an attached file, and it cannot stop Hermes from reaching the same
file or command by another route. Refusing an answer given mid-turn is
deliberately out of scope, because it would strand a turn Hermes already started.

### Protecting the rules from the agent

`config.json` lives in Kana's data root, normally `~/.kana`, which Hermes can
read and write when Kana and Hermes run as the same user account. Kana itself
never writes a `config.json` that already exists, but that says nothing about
Hermes: a turn that empties `guardrails.rules` — directly, through a shell
command, or through a subagent or an MCP tool — turns the layer off, because Kana
reads an empty rule list as the owner not using the guardrail. Kana cannot
prevent that from inside its own process, and the guardrail's server-side nature
does not change it.

The owner can close it with an operating-system lock instead:

```bash
sudo chattr +i ~/.kana/config.json   # lock: no process may change or delete it
lsattr ~/.kana/config.json           # the flags line must show "i"
```

While the immutable flag is set, `config.json` cannot be changed, renamed, or
deleted by any process, including Hermes, Kana, and the owner, even with root.
The owner lifts it before editing and sets it again afterwards:

```bash
sudo chattr -i ~/.kana/config.json   # unlock
$EDITOR ~/.kana/config.json          # edit the rules
sudo chattr +i ~/.kana/config.json   # lock again
```

The flag is a filesystem attribute, not a Kana feature: Kana never runs `chattr`,
never asks for root, and offers no setting for it. It needs a filesystem that
supports the attribute (ext4, xfs, btrfs), it needs root to set and clear, and it
is limited to the file — do not mark the data-root directory immutable, because
Kana must keep writing `appstate.db`, `activities.db`, and `jwt-secret` beside it.
It also stops only change, never reading, so Hermes can still read the key and the
rules; and anyone who holds root can lift it.

Set the flag only when no legacy data root is still to be migrated: a move copies
`config.json` out of a legacy root, and a failed copy is logged as a warning
rather than raised, so a lock left on during a move goes unnoticed. Kana needs no
write access to the file for its own operation — `ensureKanaUserConfigFile`
returns as soon as the file exists — so the lock leaves reading, the guardrail,
and normal startup unaffected.

## Delivered files

Hermes names a file in a reply with `MEDIA:/local/path`. Before relaying, Kana's
server rewrites each deliverable path to `MEDIA:/api/media/<token>/<name>`, so
the browser never receives a filesystem path:

- the token is the resolved path, encrypted and authenticated with AES-256-GCM
  under a key derived from the installation secret. The browser cannot name a
  path, the same file always gets the same link across restarts, and there is no
  table to store or expire;
- a deliverable file must exist, be regular, and resolve its symlinks outside
  system paths (`/etc`, `/proc`, `/sys`, `/dev`, `/boot`, `/var/log`,
  `/var/lib`, `/var/run`); home credential folders (`.ssh`, `.aws`, `.gnupg`,
  `.config`, browser profiles, and similar); home secret files (`.npmrc`,
  `.git-credentials`, `.netrc`, keyrings, shell histories, and similar);
  Hermes's own secrets (`.env`, `config.yaml`, `auth.json`, ...); and Kana's
  data root;
- any other path, and any `MEDIA:` example inside code, stays as text. The media
  route checks the file again on every request.

## Reverse proxy (VPS)

When Kana runs behind Nginx, the proxy must preserve the public request metadata:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`Host $http_host` matters for the cross-site guard, which compares the browser's
`Origin` with the host the request was addressed to. Use `$http_host`, not
`$host`: `$host` drops the port, so on a public port other than 80/443 every
write is rejected as cross-site. A proxy that rewrites `Host` must forward the
public one as `X-Forwarded-Host`, or the operator must list the public origin
(for example `KANA_TRUSTED_ORIGINS=https://kana.example`, comma-separated).
Trusted origins also name hosts allowed in local mode. `X-Forwarded-Proto
$scheme` keeps session cookies `Secure`; if the proxy cannot forward it, set
`AUTH_COOKIE_SECURE=true`. A valid Kana session authorizes the same process
controls for Hermes and the voice-engine download.

## Offline shell

The production service worker caches the statically rendered root shell, the
manifest, the icon, and same-origin Next static assets. It never stores
transcript data, IndexedDB records, credentials, protected input, external
Live2D assets, Hermes WebSockets, speech requests, or application API responses.
Offline mode therefore restores the UI and a CSS fallback only; it does not
imitate a working agent or voice service.

## Backup and removal

Kana has a versioned, field-bounded, parser-validated backup format
(`lib/backup/kana-backup.ts`) that carries conversations and non-secret
preferences only: Hermes tokens and imported avatar assets are excluded. No
Settings control exposes it in this release, so treat it as a library rather
than a user feature. Imported Live2D files must be moved separately according to
their license. Clearing this site's browser storage removes Kana-local data
alone and leaves Hermes untouched.
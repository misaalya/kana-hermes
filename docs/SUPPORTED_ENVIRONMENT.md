# Supported environment and compatibility

Kana 0.3.1 is a stable semver release for the tested Linux baseline below. It
supports both a personal loopback installation and a VPS deployment of the
same server. “Stable” describes the versioning and documented behavior; it
does not claim support for platforms that have not been tested.

## Tested baseline

- Linux x86_64 glibc host with Node.js 22.22.2. The npm package requires
  Node.js 22.13 or newer because Kana uses the built-in `node:sqlite` module.
- Next.js 16.3.1 standalone server bound to loopback.
- Current Chromium/Google Chrome desktop and 390 × 844 mobile emulation;
  automated reflow checks cover 320, 360, 390, 768, and 1440 CSS pixels plus
  mobile landscape. A production Chrome profile also passes manifest
  installability and an offline service-worker shell reload.
- Hermes Agent 0.20.1 (2026.8.13) through `hermes serve` JSON-RPC/WebSocket.
  The live audit observed the registry dynamically and does not pin command
  counts as a protocol guarantee.
- Optional local voice: irodori-c `v0.2.0` prebuilt Linux x86-64 release with the
  pinned Irodori-TTS v4.1 Anime revision (verified on an Intel i3-1005G1, int8).
- Official pinned Live2D Haru and Mao samples load and switch in Chrome with
  model-specific `ParamMouthOpenY`/`ParamA` bindings.

Other current Chromium browsers should work but are not a release claim yet.
Firefox and Safari require a future CI target, especially for folder input,
WebGL, Web Audio, and IndexedDB behavior.

## Browser capabilities

Kana needs JavaScript, IndexedDB, local/session storage, WebSocket, Web Audio,
Blob/object URLs, and WebGL for the real avatar. An avatar placeholder is shown when the model cannot load; audio failures
are reported explicitly with a text fallback. No mock voice or agent is used.

## Storage and hardware

- Kana's web package is small compared with model runtimes; conversation usage
  depends on history length and imported Live2D assets.
- Every imported Live2D folder is shown with its browser-local size. Browser
  quota is implementation-specific.
- The local voice engine needs Linux x86-64, glibc 2.35+, an AVX2/FMA CPU, about
  3.9 GB of disk (480 MB engine download plus the 3.1 GB model, unless reused
  from the Hugging Face cache), and 1.4–2 GB of RAM per utterance. It runs on
  CPU only and is slower than realtime on small CPUs: on the reference 2-core
  i3-1005G1 at the default 16 steps, a 2.3-second reply took 6.8 s with the
  model's own voice and a 4-second reply took 21.6 s with the bundled reference
  voice (the reference is re-encoded for every utterance). macOS, Windows, and ARM hosts use an
  OpenAI-compatible provider instead.

## Known limitations

- The global launcher can supervise local Hermes and an explicitly configured
  voice engine processes, but Kana remains a web package rather than a signed desktop
  application. Starting `server.js` directly does not add native OS lifecycle
  integration.
- Streaming speech is deferred. Complete WAV is the default; experimental
  sentence delivery plays ordered complete WAV parts and remains opt-in until
  target-host latency evidence supports changing the default.
- Hermes owns conversation history on the server; avatar packages and UI
  preferences are browser-local.
- Real restart recovery while every kind of pending Hermes protected input,
  two custom Live2D packages, and local voice p50/p95 still need target-host
  field validation before broader platform support is claimed.

## Hermes auto-detection on Linux

Kana finds Hermes in two ways, both implemented once in
`shared/hermes-discovery.mjs` and used by the launcher and the server:

1. **Executable**: `KANA_HERMES_BIN`, `hermes.executable` in `config.json`,
   every `PATH` directory, then the layouts Hermes's official installer and
   common package managers create — `~/.local/bin` (installer user layout,
   pipx, uv tool), `$XDG_BIN_HOME`, `$HERMES_INSTALL_DIR`,
   `~/.hermes/hermes-agent/venv/bin`, `/usr/local/bin` and
   `/usr/local/lib/hermes-agent/venv/bin` (installer root layout),
   `$PREFIX/bin` (Termux), Nix profiles (`~/.nix-profile/bin`,
   `/nix/var/nix/profiles/default/bin`, `/run/current-system/sw/bin`), and
   Homebrew on Linux. This works identically on Debian/Ubuntu, Fedora/RHEL,
   Arch, openSUSE, and NixOS. systemd services receive a minimal `PATH`, which
   is why the fixed locations matter.
2. **Running gateway**: `/proc/<pid>/cmdline` is parsed the way Hermes itself
   recognises `hermes serve` (including `python -m hermes_cli.main serve`,
   `--port=N`, and Hermes's default port 9119 when `--port` is omitted). No
   `pgrep`/procps is needed, so minimal containers work too. Desktop's
   ephemeral `--port 0` servers and non-loopback binds are ignored.

The gateway token is read from `/proc/<pid>/environ`, which Linux exposes only
to the **same user** (or root). Kana must therefore run under the account that
owns Hermes. A gateway started by hand without `HERMES_DASHBOARD_SESSION_TOKEN`
has a random in-memory token that no other process can learn; let Kana start
Hermes instead. If an adopted gateway restarts with a new token or port, Kana
re-discovers it on the next failed connection. `kana doctor` shows what was
found, including whether each running gateway's token is readable.

## VPS deploy checklist

Kana's server-side files (`appstate.db` containing the auth hash, `jwt-secret`,
and `activities.db`) live in one authoritative data directory resolved as
`KANA_DATA_DIR` → `$XDG_DATA_HOME/kana` → `~/.local/share/kana`. Files from the
legacy roots (`./data`, `~/.kana`) and the former standalone `auth.json` store
are migrated automatically on first use. Never run Kana in production without
an explicit data directory.

1. Run Kana under the Linux account that owns Hermes (see above), and give it
   a persistent data directory:

   ```bash
   sudo mkdir -p /var/lib/kana
   sudo chown "$USER": /var/lib/kana
   ```

2. Configure the deployment mode and persistent data root (systemd
   `Environment=` lines or an untracked `.env.production` next to the
   deployment):

   ```bash
   KANA_DEPLOYMENT_MODE=deployment
   KANA_DATA_DIR=/var/lib/kana
   AUTH_COOKIE_SECURE=true            # if nginx does not forward X-Forwarded-Proto
   ```

   `KANA_JWT_SECRET` is optional. When omitted, Kana generates an owner-only
   secret atomically under `KANA_DATA_DIR` and reuses it across restarts. An
   explicit value must contain at least 32 characters. Keep the data directory
   persistent across redeploys.

3. Deploy the complete contents of `.next/standalone` (after
   `npm run package:local`) to `/opt/kana`. Set the access password once as
   the service account — Kana refuses to start without one and has no default:

   ```bash
   KANA_DATA_DIR=/var/lib/kana node /opt/kana/bin/kana.mjs password
   ```

   With the npm package use `KANA_DATA_DIR=/var/lib/kana kana password`.
   For automation, pipe it: `printf '%s\n' "$PASSWORD" | kana password --stdin`.

   Then use this systemd unit example (replace `your-user`):

   ```ini
   [Unit]
   Description=Kana web UI
   After=network-online.target

   [Service]
   User=your-user
   Group=your-user
   WorkingDirectory=/opt/kana
   Environment=KANA_DATA_DIR=/var/lib/kana
   Environment=AUTH_COOKIE_SECURE=true
   ExecStart=/usr/bin/node /opt/kana/bin/kana.mjs serve --port 3000
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```

   `kana serve` forces deployment mode, binds `127.0.0.1`, forwards
   `KANA_DATA_DIR`, and passes the Hermes executable it found to the server.
   systemd sets `HOME` for `User=` services. If installed from npm on the VPS,
   replace `ExecStart` with the absolute installed `kana` path and
   `serve --port 3000`. See [the installation choices](INSTALLATION.md). Run
   one process per data root; clustered workers do not share Hermes sockets or
   cancellation state.

4. Nginx must preserve the public request metadata and give long requests
   enough time. The values below match Kana's code: the largest request body
   is 14 MiB (`lib/limits.ts`; Next truncates anything longer), long Hermes
   RPCs such as `/compress` may take 180 s, and speech may take up to
   `tts.timeoutSeconds` (default 900 s):

   ```nginx
   location / {
       client_max_body_size 14m;
       proxy_read_timeout 200s;
       proxy_send_timeout 200s;
       proxy_pass http://127.0.0.1:3000;
       proxy_http_version 1.1;
       proxy_set_header Host $http_host;
       proxy_set_header X-Forwarded-Proto $scheme;
   }

   location = /api/hermes/events {
       proxy_pass http://127.0.0.1:3000;
       proxy_http_version 1.1;
       proxy_set_header Host $http_host;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_buffering off;
       proxy_read_timeout 1h;
   }

   location = /api/voice/tts/speech {
       proxy_pass http://127.0.0.1:3000;
       proxy_http_version 1.1;
       proxy_set_header Host $http_host;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_buffering off;
       proxy_read_timeout 910s;
       proxy_send_timeout 910s;
   }
   ```

   Keep the speech timeout above `tts.timeoutSeconds`. `Host $http_host` (which keeps a
   non-default port, unlike `$host`) is required by the cross-site request guard (see [SECURITY.md](SECURITY.md#reverse-proxy-vps)).
   Terminate HTTPS at Nginx. Do not expose Kana only as a public `http://IP`
   origin: browser autoplay behavior is less reliable there and installable
   web-app features require a secure context.

5. First-request sanity check: `/api/auth/status` reports
   `"authEnabled": true` and `"passwordConfigured": true`, and
   `kana doctor` (or `node /opt/kana/bin/kana.mjs doctor`) run as the service
   account shows Hermes and the password as set.

# Supported environment and compatibility

Kana 0.2.x is an alpha local web application.

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
- Optional Qwen service Python 3.10–3.13 with `qwen-tts==0.1.1` and the pinned
  0.6B Base revision.
- Official pinned Live2D Haru and Mao samples load and switch in Chrome with
  model-specific `ParamMouthOpenY`/`ParamA` bindings.

Other current Chromium browsers should work but are not a release claim yet.
Firefox and Safari require a future CI target, especially for folder input,
WebGL, Web Audio, and IndexedDB behavior.

## Browser capabilities

Kana needs JavaScript, IndexedDB, local/session storage, WebSocket, Web Audio,
Blob/object URLs, and WebGL for the real avatar. Mock avatar and voice remain
available when WebGL, audio, internet, Hermes, or Qwen is unavailable.

## Storage and hardware

- Kana's web package is small compared with model runtimes; conversation usage
  depends on history length and imported Live2D assets.
- Every imported Live2D folder is shown with its browser-local size. Browser
  quota is implementation-specific.
- Qwen needs an isolated Python environment, roughly 2.3 GB model download,
  and at least 4 GB free disk before setup. CPU works but may be slower than
  realtime. The reference MX330's 2 GB VRAM is not a supported CUDA target.

## Known limitations

- The global launcher can supervise local Hermes and an explicitly configured
  Qwen service, but Kana remains a web package rather than a signed desktop
  application. Starting `server.js` directly does not add native OS lifecycle
  integration.
- Qwen streaming is deferred. Complete WAV is the default; experimental
  sentence delivery plays ordered complete WAV parts and remains opt-in until
  target-host latency evidence supports changing the default.
- History and avatar packages are browser-local; no cloud sync is provided.
- Real restart recovery while every kind of pending Hermes protected input,
  two custom Live2D packages, and real Qwen p50/p95 still need target-host
  acceptance before beta.

## VPS deploy checklist

Kana's server-side files (auth hash, JWT secret, activity database) live in one
authoritative data directory resolved as `KANA_DATA_DIR` → `$XDG_DATA_HOME/kana`
→ `~/.local/share/kana`. Files from the legacy roots (`./data`, `~/.kana`) are
migrated automatically on first use. Never run Kana in production without an
explicit data directory.

1. Create a non-root user and its data directory:

   ```bash
   sudo useradd --system --create-home --home-dir /var/lib/kana kana || true
   sudo chown kana:kana /var/lib/kana
   ```

2. Provide the deployment password outside git (systemd `Environment=` lines
   or an untracked `.env.production` next to the deployment):

   ```bash
   KANA_DEPLOYMENT_MODE=deployment
   KANA_ACCESS_PASSWORD=<bootstrap password, or pre-seed auth.json>
   KANA_DATA_DIR=/var/lib/kana
   AUTH_COOKIE_SECURE=true            # if nginx does not forward X-Forwarded-Proto
   ```

   `KANA_JWT_SECRET` is optional. When omitted, Kana generates an owner-only
   secret atomically under `KANA_DATA_DIR` on the first readiness request and
   reuses it across restarts. An explicit value must contain at least 32
   characters and is useful only when multiple Kana server instances must
   share sessions. Keep the data directory persistent across redeploys.

3. systemd unit example:

   ```ini
   [Unit]
   Description=Kana web UI
   After=network-online.target

   [Service]
   User=kana
   Group=kana
   WorkingDirectory=/var/lib/kana
   Environment=KANA_DATA_DIR=/var/lib/kana
   Environment=KANA_DEPLOYMENT_MODE=deployment
   Environment=KANA_ACCESS_PASSWORD=<bootstrap password>
   Environment=AUTH_COOKIE_SECURE=true
   Environment=HOSTNAME=127.0.0.1
   Environment=PORT=3000
   ExecStart=/usr/bin/node /opt/kana/.next/standalone/server.js
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```

   The npm launcher (`kana`) resolves and forwards `KANA_DATA_DIR` and an
   explicit `HOME` into the spawned Next server automatically; under systemd,
   set both explicitly as shown.

4. nginx must forward:

   ```nginx
   proxy_set_header Host $host;
   proxy_set_header X-Forwarded-Proto $scheme;
   proxy_set_header X-Kana-Trusted-Proxy "";
   ```

   Terminate HTTPS at Nginx. Public HTTP-only origins have stricter mobile
   audio and installable-web-app limitations and are not the intended
   deployment baseline. See docs/SECURITY.md for the full trust model.

5. First-request sanity check: with auth configured, `/api/auth/status`
   reports `"authEnabled": true` and never `insecureNoAuth: true`. If the
   server logs the no-auth security warning at boot, fix the environment
   before exposing the port.

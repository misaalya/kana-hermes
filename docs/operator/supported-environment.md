# Supported environment

Kana is validated against one Linux baseline. This document lists that
baseline, the limits it implies, and the steps for a VPS deployment.

**Read when:** you are choosing a host for Kana, checking whether a platform is supported, or deploying Kana on a VPS.
**Truth in code:** `cli/package.json`, `lib/server/irodori/platform.ts`, `shared/hermes-discovery.mjs`, `lib/limits.ts`

## Tested baseline

| Component | Tested |
| --- | --- |
| Host OS | Linux x86_64 with glibc; 2.35 or newer for the local voice engine |
| Node.js | 22.13 or newer; validated on 22.22 |
| Kana | 0.6.1 on Next.js 16.3.1, standalone server bound to loopback |
| Browser | current Chromium/Chrome desktop and 390 × 844 mobile emulation; reflow checked at 320, 360, 390, 768, and 1440 CSS pixels plus mobile landscape; a production Chrome profile also passes manifest installability and an offline service-worker reload |
| Hermes Agent | 0.20.1 (2026.8.13) through `hermes serve` JSON-RPC/WebSocket |
| Local voice (optional) | irodori-c `v0.2.0` prebuilt Linux x86-64 release with Irodori-TTS v4.1 Anime revision `6b259f5b`, verified on an Intel i3-1005G1 with int8 |
| Avatar | official pinned Live2D Haru and Mao samples, with model-specific `ParamMouthOpenY` and `ParamA` bindings |

The published npm package (`kana-alya`) declares `os: linux`, `cpu: x64`, and
`libc: glibc`, so npm refuses other targets. A stable version number does not
make an untested host supported.

## Explicitly unsupported

- Server hosts other than Linux x86-64 with glibc; macOS, Windows, ARM, and musl
  are not supported targets.
- Local voice outside Linux x86-64: the engine needs glibc 2.35 or newer and an
  x86-64-v3 CPU (AVX2 and FMA), with the FP32 OpenBLAS binary when AVX-512 VNNI
  is absent. Other hosts use the external provider.
- More than one Kana server process per data root. The shared Hermes WebSocket,
  the request-cancellation registry, and the voice-engine supervisor live in
  that process; clustered replicas against one directory are not supported.
- Serverless and function hosts such as Vercel. Kana needs one long-lived
  process with in-memory gateway state, SSE streams, SQLite storage, and a
  writable data root. A remote Hermes changes where the agent runs, not this
  hosting requirement.
- Firefox and Safari may work, but their folder input, WebGL, Web Audio, and
  IndexedDB behavior has no release claim until a CI browser target exists.
- Streaming speech, and a signed native desktop application: Kana is a web
  package, not an OS-level service manager.

## Browser capabilities

Kana needs JavaScript, IndexedDB, local and session storage, WebSocket, Web
Audio, Blob/object URLs, and WebGL for the real avatar. When a model cannot
load, Kana shows an explicit placeholder avatar rather than a mock, and audio
failures are reported with a text fallback; no mock voice or agent is used.
Conversation storage is browser-local (IndexedDB) plus the server-side activity
log, while Hermes owns the transcript. Imported Live2D folders are stored
locally with their size shown; browser quota is implementation-specific.

## Local voice engine

Local speech is optional, downloaded only from Settings → Voice, and every
artifact is pinned by size and SHA-256 before use.

- Disk: about 3.9 GB once installed, and roughly 4.3 GB free while the installer
  stages the downloads beside the extracted files. A model already in the Hugging
  Face cache is adopted instead of downloaded.
- Memory: about 1.4–2 GB per utterance, and utterances are serialized; a request
  queues rather than running in parallel.
- CPU only, and slower than realtime on small CPUs. On the reference 2-core
  i3-1005G1 at the default 16 steps, a 2.3-second reply took 6.8 s with the
  model's own voice, and a 4-second reply took 21.6 s with the bundled reference
  voice, which is re-encoded for every utterance.
- The engine accepts 256 text tokens or 30 seconds of audio per utterance, and
  the audio cap binds first. Kana splits a longer reply into ordered parts and
  joins the WAVs.

The browser reaches the engine only through Kana's relay (`/api/voice/tts/*`),
never directly, and nothing falls back to an external provider on its own.

## Known limitations

- Local speech latency on small CPUs is what the numbers above measure; the
  sentence-delivery experiment stays opt-in until target-host evidence supports
  changing the default.
- Conversation history belongs to Hermes on the server. Avatar packages and UI
  preferences are browser-local, so a different browser starts with its own.
- Restart recovery for every kind of pending Hermes protected input, two custom
  Live2D packages, and target-host voice p50/p95 still need field validation.
- Hermes 0.21's batch clarify requests, and the pending approval or clarify it
  replays on `session.resume`, are implemented from that protocol. Hermes 0.22+
  moves clarify, approval, sudo, and secret prompts to server-to-client JSON-RPC
  requests; Kana advertises `client.capabilities`, bridges those requests, and
  restores `open_requests`. Those 0.22.5 shapes were compared against the
  0.22.5 gateway contract and an installed 0.22.5 source tree. The tested
  baseline remains 0.20.1; live 0.22.5 interaction still needs owner validation.

## Hermes auto-detection on Linux

Kana finds Hermes two ways, both implemented once in
`shared/hermes-discovery.mjs` and shared by the launcher and the server.

1. **Executable lookup.** Candidates in order: `KANA_HERMES_BIN`,
   `hermes.executable` in `config.json`, every `PATH` directory, then the
   layouts Hermes's installer and package managers create — `~/.local/bin`,
   `$XDG_BIN_HOME`, `$HERMES_INSTALL_DIR`, `~/.hermes/hermes-agent/venv/bin`,
   `/usr/local/bin`, `/usr/local/lib/hermes-agent/venv/bin`, `$PREFIX/bin`
   (Termux), Nix profiles, and Homebrew on Linux. systemd services receive a
   minimal `PATH`, which is why the fixed locations matter.
2. **Running gateway.** `/proc/<pid>/cmdline` is parsed the way Hermes
   recognises `hermes serve`, including `python -m hermes_cli.main serve`,
   `--port=N`, and Hermes's default port 9119 when `--port` is omitted. Ephemeral
   `--port 0` servers and non-loopback binds are ignored, and no `pgrep` or
   procps is needed.

The session token is read from `/proc/<pid>/environ`, which Linux exposes only
to the same user (or root); Kana must run under the account that owns Hermes. A
gateway started by hand is adopted when its environment carries the token:

```bash
HERMES_DASHBOARD_SESSION_TOKEN=<token> hermes serve --host 127.0.0.1 --port 9119
```

Without that variable the token is random and in-memory, and no other process
can learn it; let Kana start Hermes instead. The connection screen names this
case and asks for the process to be stopped, and the next attempt starts Hermes
under Kana. If an adopted gateway restarts with a new token or port, Kana
re-discovers it on the next failed connection. `kana doctor` reports what was
found, including token readability.

## Remote Hermes

A `hermes.remote` block in `config.json` points Kana at a dashboard on another
machine and disables local discovery and process control. The URL must use
`wss://`, and the dashboard must use Hermes's `basic` provider with a username
and password supplied in the owner-only file or through
`hermes.remote.auth.passwordEnv`; neither reaches the browser. Kana logs in,
keeps the cookie in server memory, and requests a fresh WebSocket ticket for
each connection. The remote machine must expose `/auth/password-login`,
`/api/auth/ws-ticket`, `/api/auth/ws`, and `/api/health` behind TLS, and the Kana
host must be able to reach it. Conversation transcripts stay on that Hermes;
Kana's data root still holds authentication, SQLite state, preferences, and the
activity log.

An Instabox VM can pause while idle. When `hermes.remote.wake` is configured,
Kana's connection screen can run the installed `instabox` CLI on the Kana host,
then poll health. The CLI must be installed and logged in there; Kana does not
run a shell and accepts no wake input from the browser. `configure.md` has the
keys, and `security.md` has the controls.

## VPS deploy checklist

Kana keeps all server-side files (`auth.password`, the session secret, and
`activities.db`) in one data directory resolved as `KANA_DATA_DIR` →
`~/.kana`. Files from earlier roots (`$XDG_DATA_HOME/kana`,
`~/.local/share/kana`, `./data`) are moved into it on the first start.

A service unit needs no second data root. For a local gateway Kana must run
under the account that owns Hermes, because Linux only lets that user read the
Hermes session token; that account already has a home, and `~/.kana` is its data
root, exactly as on a desktop. A remote gateway removes that ownership
requirement but not the data root. Set `KANA_DATA_DIR` only when you
deliberately want the state elsewhere, for example a dedicated volume; it must
then be an absolute path the service account can write.

1. Run Kana under the Linux account that owns Hermes (see above).

2. Configure the deployment mode — systemd `Environment=` lines, or an untracked
   `.env.production` next to the deployment:

   ```bash
   KANA_DEPLOYMENT_MODE=deployment
   AUTH_COOKIE_SECURE=true            # if nginx does not forward X-Forwarded-Proto
   # KANA_DATA_DIR=/srv/kana          # only to move the state out of ~/.kana
   ```

   `KANA_JWT_SECRET` is optional; when omitted, Kana generates an owner-only
   secret atomically under the data directory and reuses it across restarts. An
   explicit value must contain at least 32 characters.

3. Deploy the whole `.next/standalone` output (after `npm run package:local`) to
   `/opt/kana`, or install the npm package. Set the access password once as the
   service account; Kana refuses to start without one and has no default:

   ```bash
   node /opt/kana/bin/kana.mjs password
   # npm package instead:
   kana password
   # automation:
   printf '%s\n' "$PASSWORD" | kana password --stdin
   ```

   A systemd unit for a standalone deployment (replace `your-user`):

   ```ini
   [Unit]
   Description=Kana web UI
   After=network-online.target

   [Service]
   User=your-user
   Group=your-user
   WorkingDirectory=/opt/kana
   Environment=AUTH_COOKIE_SECURE=true
   ExecStart=/usr/bin/node /opt/kana/bin/kana.mjs serve --port 3000
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```

   `kana serve` forces deployment mode, binds `127.0.0.1`, and passes the Hermes
   executable it found to the server. If Kana came from npm, replace `ExecStart`
   with the absolute installed `kana` path followed by `serve --port 3000`. Run
   one process per data root.

4. Nginx must preserve the public request metadata and allow long requests. The
   values below match Kana's code: the largest request body is 14 MiB
   (`lib/limits.ts`, and Next truncates anything longer), long Hermes RPCs such
   as `/compress` may take 180 s, and speech may take up to `tts.timeoutSeconds`
   (default 900):

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
   ```

   The event stream (`/api/hermes/events`) and speech
   (`/api/voice/tts/speech`) each need their own `location` with
   `proxy_buffering off`, the same `proxy_pass` and
   `proxy_set_header Host $http_host;` line, and a longer
   `proxy_read_timeout`: 1h for events, above `tts.timeoutSeconds` for speech,
   and at least the configured Instabox wake timeout (default 120s) for
   `/api/hermes/wake`.

   Keep those timeouts above `tts.timeoutSeconds`. `Host $http_host` keeps a
   non-default port, unlike `$host`, and the cross-site request guard requires
   it (see `security.md`). Terminate HTTPS at Nginx. Do not expose Kana only as
   a public `http://IP` origin: browser autoplay and installable web-app
   features require a secure context.

5. First-request sanity check: `/api/auth/status` reports `"authEnabled": true`
   and `"passwordConfigured": true`, and `kana doctor` run as the service account
   shows Hermes and the password as set.
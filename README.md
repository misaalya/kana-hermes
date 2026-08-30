# Kana

Kana is a local web presentation layer for an existing [Hermes Agent](https://github.com/NousResearch/hermes-agent) installation. Hermes remains the only agent and continues to own reasoning, tools, terminal access, files, MCP, subagents, memory, sessions, and context management.

Kana adds:

- a game-style visual-novel conversation surface: pastel sky stage, centered
  avatar, and a named speech bubble in the manner of character games — without
  copying any game's artwork, characters, or proprietary assets;
- a Japanese-speaking presentation persona and structured response protocol;
- user-selectable subtitle languages for future responses;
- locally persistent conversation history that preserves the exact subtitle text and language originally displayed;
- replaceable TTS and avatar providers while Hermes remains the only agent;
- a responsive Live2D canvas with two official free sample avatars and
  replaceable, locally persistent URL/folder model sources;
- local Qwen3-TTS speech with voice cloning, plus a server-side
  OpenAI-compatible speech adapter with a Pollinations preset;
- an npm global launcher that starts the packaged web app and can discover or
  supervise the user's unmodified `hermes serve` process;
- a mobile-safe workspace plus an installable offline app shell and a
  standalone production package;
- first-run setup, safe local diagnostics, per-conversation drafts/search, and
  credential-free conversation backup/restore.

## Installation

Kana supports two production installation paths:

1. install the published package globally from npm (the intended path for
   normal users); or
2. build the standalone production server from a source checkout (the path
   for contributors, custom builds, and VPS operators).

`npm run dev` is not an installation or deployment method. It is only the
local development server and must not be kept behind Nginx as a production
Kana instance.

### Install globally from npm (recommended user flow)

> **Published package:** [`kana-alya`](https://www.npmjs.com/package/kana-alya).
> The command below installs the prebuilt production runtime; it does not build
> the frontend from source on the user's machine.

```bash
npm install -g kana-alya
kana
```

`kana-alya` is also installed as a command alias for users who prefer the package
name (`kana-alya` and `kana` start the same launcher).

The published package contains a thin launcher plus the traced standalone web
runtime, so it does not compile Kana on the user's machine. Running `kana`
binds the app to `127.0.0.1`, opens the browser, preserves Kana's in-app
personalization wizard, and automatically tries to connect to or start the
installed Hermes service. It never asks for a Hermes token in the browser and
does not block first start with a terminal setup prompt.

The global npm install itself deliberately does not write user configuration:
it may be executed with `sudo`, which would create root-owned files in the
wrong home directory. The first `kana` launch performs an idempotent bootstrap
under the actual account running Kana. It creates an owner-only `config.json`,
generates and persists a cryptographically random JWT signing secret, and lets
the server create its databases as they are first needed. Existing files are
never overwritten.

Hermes discovery checks, in order, an explicit environment/JSON override,
every directory in `PATH`, Hermes-managed homes and virtual environments,
`~/.local/bin`, Termux's prefix, and standard system locations. Kana also
adopts a compatible running `hermes serve` when its server-side session token
can be recovered. If all automatic checks fail, `kana doctor` prints the
resolved config path; set the absolute `hermes.executable` there and restart
Kana.

The current prebuilt target is Linux x64 with glibc and Node.js 22.13 or newer.
The package declares those limits so npm rejects unsupported systems instead
of installing a runtime built for a different platform. Windows, macOS, ARM64,
and musl/Alpine packages require separate build artifacts and testing.

The multi-gigabyte Qwen3-TTS model, its isolated Python environment, cloned
voice profiles, and all Kana data live under Kana's resolved data root, never
inside the npm package. Voice setup remains optional and explicit. The
launcher has no second Qwen configuration or background process; the Kana
server manages the selected provider from its central `config.json`.

Other commands:

```bash
kana setup        # configure or reconfigure optional Qwen3-TTS voice
kana config       # open/print the editable advanced JSON path
kana doctor       # check Hermes/uv availability and data locations
kana --port 4000  # choose the local web port
```

Kana's server may start, restart, and stop the official `hermes serve` gateway
on loopback. It mints and keeps the Hermes session token in server memory; the
token never reaches browser preferences, storage, URLs, or forms. Kana only
spawns the unmodified Hermes executable and never edits its installation.

Kana is released under the [MIT License](LICENSE).

### Build and run from source

Use this path when testing unreleased Kana code, maintaining a custom build,
or deploying a source checkout to a VPS. It produces the same traced
standalone Next.js runtime used by the npm package; it does not run the
development server.

For a local production build:

```bash
git clone https://github.com/misaalya/kana-hermes.git
cd kana-hermes
npm ci
npm run package:local

HOSTNAME=127.0.0.1 PORT=3000 node .next/standalone/server.js
```

For a VPS or reverse-proxy deployment, create an explicit persistent data
directory owned by the account that will run Kana. Put its `config.json`
there, select `deployment` mode, configure an access password outside Git,
and run the standalone server on loopback:

```bash
git pull
npm ci
KANA_DATA_DIR=/var/lib/kana npm run config
npm run package:local

KANA_DATA_DIR=/var/lib/kana \
KANA_DEPLOYMENT_MODE=deployment \
KANA_ACCESS_PASSWORD='REPLACE_WITH_A_STRONG_PASSWORD' \
HOSTNAME=127.0.0.1 \
PORT=3000 \
node .next/standalone/server.js
```

Run that command through a service manager such as systemd and terminate
HTTPS at Nginx. The reverse proxy must preserve the Host and
`X-Forwarded-Proto` headers, disable buffering for `/api/hermes/events`, and
allow a long read timeout for Hermes SSE and speech generation. See the
[VPS deploy checklist](docs/SUPPORTED_ENVIRONMENT.md#vps-deploy-checklist) and
[reverse-proxy security guide](docs/SECURITY.md#reverse-proxy-vps) for the
complete service and Nginx configuration.

The source checkout does not receive the global launcher's first-run
bootstrap merely from `npm ci`. `npm run config` creates or opens the same
owner-only `$KANA_DATA_DIR/config.json`; Kana generates its persistent JWT
secret under that data root on first use. Existing config and secrets are not
overwritten.

### Run locally for development only

> **Do not deploy this command.** `next dev` enables Fast Refresh/HMR and
> rebuilds assets while the process is running. Behind Nginx or on a VPS this
> can interrupt the long-lived Hermes event stream, produce transient 502s,
> and require development WebSocket proxying. Use the standalone source build
> above for every persistent, remote, or reverse-proxied installation.

```bash
npm install
npm run dev -- --hostname 127.0.0.1
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Kana connects to a real `hermes serve` gateway, uses the TTS provider selected in the server `config.json`, and renders Live2D; official sample models need internet access for the Cubism Core and sample assets, and an honest placeholder avatar is shown whenever Live2D cannot load.

## Connect to Hermes

For the normal global-install flow, install Hermes and run `kana`. Kana first
tries an existing compatible local service; if none is usable, it starts
`hermes serve` automatically and connects without showing a manual connection
form. A recovery dialog appears only when that automatic flow fails.

Advanced users may start Hermes separately with a session token of their
choice:

```bash
HERMES_DASHBOARD_SESSION_TOKEN="replace-with-a-long-local-token" \
  /home/kenobu/.local/bin/hermes serve --host 127.0.0.1 --port 9119
```

The explicit environment token lets Kana safely discover and adopt that
process from the server side. A plain manually started `hermes serve` generates
an internal random token that a separate Kana process cannot recover. In that
case, stop it and let Kana start Hermes, or restart it with the environment
variable above. The working folder remains an optional Kana preference for new
Hermes sessions.

Kana does not update, patch, or write to the Hermes installation. New Kana conversations seed a per-session Hermes system message containing the Kana persona and response contract; the user's global Hermes configuration is not changed.

Before publishing or installing a release candidate, run
`npm run test:package:npm`. It packs the exact npm artifact, installs it into an
isolated global prefix and clean user home, exercises `kana --help` and
`kana doctor`, verifies generated file permissions, starts the installed
server, starts a discovered fake Hermes executable through the packaged API,
checks the first-run state, and verifies that a foreign web origin cannot drive
the passwordless loopback API.

## Hermes slash commands

Type `/` in Kana's composer to browse the connected Hermes installation's categorized command and skill catalog. Continue typing to search it, or add a space to receive Hermes-provided argument suggestions such as reasoning levels and personality names. Kana does not maintain a copied Telegram command list: it reads Hermes's live `commands.catalog` and `complete.slash` data, then executes commands through the official `slash.exec` / `command.dispatch` RPCs. `/help` and `/commands` are rendered from that same current registry, so installed skills and newer commands remain discoverable.

Commands that need tighter live-session behavior use dedicated Hermes RPCs:

- `/approve` and `/deny` resolve the current Hermes approval request;
- `/title` reads or updates both the live Hermes session and Kana's local title;
- `/branch` creates a real Hermes session branch and a matching Kana conversation;
- `/save`, `/status`, `/compress`, `/steer`, and `/handoff` use their dedicated
  Hermes control RPCs;
- `/new`, `/sessions`, and `/resume` operate on Kana conversations, each of which retains its linked durable Hermes session;
- `/undo` uses Hermes's rewind directive and updates Kana's displayed history without retranslating older subtitles.

Messaging- or terminal-surface-only commands stay visible when Hermes reports
them, but Kana marks them unavailable and explains why instead of inventing a
Telegram, Discord, or TUI context. Use Arrow Up/Down in the menu and Enter or
Tab to place the highlighted command in the composer.

When Hermes pauses for input, Kana opens a dedicated dialog for approvals and
clarification questions. Sudo passwords and tool secrets use ephemeral password
fields and are sent directly through Hermes's official response RPCs. Their
values are not written to conversation history, activity details, preferences,
or browser storage.

Commands returned as `send` or `skill` directives are submitted to the same Hermes agent session. Kana adds its Japanese-speech/subtitle response envelope to that turn; it does not call a second model.

`hermes gateway` is the messaging gateway used by Telegram, Discord, Slack, and other platform adapters. Kana does not need to impersonate one of those platforms. `hermes serve` is the separate JSON-RPC/WebSocket backend explicitly intended for desktop and remote UI clients, and exposes richer command completion, live session, tool event, and approval interfaces. Hermes's optional OpenAI-compatible API server is useful for generic chat clients, but does not expose this full slash-command control plane.

## Voice providers

Kana defaults to its local Qwen3-TTS provider. It can instead call a server-side
OpenAI-compatible `POST /v1/audio/speech` provider; Pollinations is the first
built-in preset. User API keys stay in the owner-only `config.json` and never
enter the browser. See [advanced configuration](docs/CONFIGURATION.md#tts-providers)
for complete JSON examples.

## Run real Qwen3-TTS

Kana includes a separate Python service under `services/qwen3-tts`. It uses the
official [`qwen-tts`](https://github.com/QwenLM/Qwen3-TTS) package and the
official pinned `Qwen/Qwen3-TTS-12Hz-0.6B-Base` model. Inference never runs in
the Next.js process.

The model and CPU-only Python environment need roughly 4 GB. Configure custom
storage under `tts.qwen3Local` in Kana's `config.json`, then prepare Qwen:

```bash
kana config
kana setup
```

The first speech request starts the managed loopback service and may download
about 2.3 GB. Kana discovers the live cloned-voice catalog through its own
same-origin relay; no service URL is stored in browser settings.

### Voice cloning

The 0.6B Base model supports zero-shot speaker cloning. In
**Settings → Japanese voice → Voice clone**, record or upload consented
reference audio (up to 20 MB), name the profile, and optionally provide the
reference transcript for higher fidelity. Kana sends the audio to the local
service's clone endpoint, which embeds the speaker and stores the profile under
the service's data directory; cloned voices then appear alongside preset
speakers and can be selected like any other voice. Profiles are deletable, and
only user-created `clone-*` profiles can ever be deleted. Cloning happens
entirely on your machine: audio never leaves the local Qwen3-TTS service.

The versioned API exposes:

- `GET /v1/health`
- `GET /v1/setup`
- `GET /v1/voices`
- `POST /v1/voices/clone`
- `DELETE /v1/voices/{voice_id}` (cloned profiles only)
- `POST /v1/speech`
- `POST /v1/requests/{request_id}/cancel`

Kana sends:

```json
{
  "text": "speech_ja",
  "language": "ja",
  "voice_id": "optional voice ID",
  "emotion": "happy"
}
```

The service returns PCM WAV audio. Kana decodes it in the browser, derives
mouth openness through the Web Audio API, and cancels active generation when
voice playback is stopped. The default 0.6B model reports that it does not
support instruction-based emotion control; it still speaks Japanese and the
avatar keeps the response emotion visually. A 1.7B CustomVoice deployment can
use the same API with emotion instructions on stronger hardware.

Complete-response playback is the default. Settings also exposes experimental
sentence delivery for slow hosts: Kana splits the same `speech_ja`
deterministically, prefetches the next ordered part, and replays/cancels the
parts as one voice turn. This never sends another Hermes or translation
request. Keep the default until target-host measurements show a real benefit.

This maturity pass does not rerun multi-gigabyte model inference on the
low-resource development machine. Use the repeatable
[VPS acceptance procedure](docs/QWEN3_TTS_VPS_ACCEPTANCE.md) to verify real WAV,
cancellation, and latency on the target host. See
[the service guide](services/qwen3-tts/README.md) for configuration.

The target-host benchmark is automated:

```bash
npm run tts:acceptance -- \
  --hardware "CPU, RAM, GPU/VRAM" \
  --output qwen3-tts-vps-baseline.json
```

## Live2D models

Kana uses `pixi.js` (v6, matching AIRI) and `pixi-live2d-display` for the
replaceable Cubism Web runtime. Haru is the default development avatar and Mao is a second free
sample selectable in Settings. Both come from Live2D's official sample
repository, are pinned to one known upstream commit, and are loaded remotely
rather than redistributed by Kana. Haru and Mao intentionally use different
mouth parameters, which exercises the per-model binding layer. Kana also loads
the official Cubism Core script from Live2D's host.

To switch or replace the avatar, use **Settings → Avatar** and either choose
Haru/Mao or:

- enter a hosted URL ending in `.model3.json`; or
- choose a model folder containing one `.model3.json` file and all referenced
  `.moc3`, texture, physics, expression, and motion files.

Hosted URLs and imported folder packages are saved locally. Folder assets use
IndexedDB, so they survive reloads without being uploaded. Open the per-model
binding editor to map each model's mouth parameter, emotion expression IDs, and
motion groups (`Group` or `Group:0`). Bindings are keyed to that imported model
or URL; Kana does not assume every model uses Haru's IDs. Settings also provides
emotion, motion, and talking previews. Executable Cubism Core is restricted to
Live2D's official SDK host; custom model data can use HTTPS or localhost HTTP.

Required official-sample notice: This content uses sample data owned and copyrighted by
Live2D Inc. The sample data are utilized in accordance with terms and
conditions set by Live2D Inc. This content itself is created at the author's
sole discretion. See the [official sample model terms](https://www.live2d.com/en/learn/sample/model-terms/).

## Architecture

```text
Kana UI
  ├─ AgentClient
  │    └─ HermesAgentClient → hermes serve /api/ws
  ├─ ConversationStore
  │    └─ IndexedDbConversationStore
  │         └─ LocalConversationStore migration/fallback
  ├─ VoiceProvider
  │    └─ Qwen3TTSProvider → local API v2 (speech + voice clones)
  │                         → AudioLipSyncController
  ├─ AvatarProvider
  │    ├─ ManagedAvatarProvider → placeholder fallback state
  │    └─ Live2DAvatarProvider → PixiLive2DRuntimeAdapter → Cubism Web
  │                             └─ IndexedDbAvatarModelStore
  └─ Hermes control panel
       └─ /api/local-runtime/hermes → LocalHermesRuntime → `hermes serve`
```

Hermes events are translated into Kana's stable internal event model. The current Hermes adapter maps session, message, status, tool, interruption, and input-request events. It does not infer a separate filesystem protocol from tool output.

## Current integration limitations

- CPU Qwen3-TTS is slower than realtime on the target MX330 laptop, and direct WAV playback is used instead of streaming audio.
- Kana history and imported avatars are browser-local; there is no cloud sync
  or cross-browser model library. Hermes keeps its own independently managed
  session history.
- The npm launcher supervises Qwen3-TTS and, when launched through it, the
  official `hermes serve` process. It remains a local launcher, not an OS-native
  signed desktop binary.

Stored preferences always resolve to the real agent, voice, and avatar modes;
legacy values from older installs are normalized away on load.

## Production package details

The source installation flow above runs `npm run package:local` and starts
`.next/standalone/server.js` directly from the checkout root.

The package contains the traced Next.js runtime, static assets, README, and the
versioned Qwen3-TTS service source/lockfile. It intentionally excludes the
multi-gigabyte Python runtime and model cache, and it never bundles or modifies
Hermes. The manifest and production service worker let a supporting browser
install Kana and reopen its UI shell offline. Agent and voice calls are never
faked offline: the worker ignores cross-origin traffic and `/api`, while the
CSS avatar remains the honest fallback.

The standalone directory also includes dependency-free release tools. Run
`node tools/qwen3-tts-acceptance.mjs` on the target Qwen host and
`node tools/dogfood-check.mjs dogfood/journal.json` during beta acceptance.
The source checkout exposes the same tools through the shorter npm commands.

## Checks

```bash
npm run quality
```

The gate includes lint, TypeScript, unit/integration tests, desktop/mobile
browser journeys, lightweight acceptance-harness self-tests, production build,
standalone package assembly, and a production installability/offline-shell
audit. Enable
Python service tests only where the isolated Qwen runtime is available:

```bash
KANA_RUN_TTS_SERVICE_TESTS=1 npm run quality
```

The real official-model switch journey is separate because it downloads the
pinned Live2D assets:

```bash
npm run test:live2d:official
```

Operational references:

For a VPS or reverse proxy, set `KANA_DEPLOYMENT_MODE=deployment` (or edit the
JSON shown by `npm run config` / `kana config`), configure a Kana access
password, and use HTTPS.

- [quality and user journeys](docs/QUALITY.md)
- [local security model](docs/SECURITY.md)
- [Qwen3-TTS VPS acceptance](docs/QWEN3_TTS_VPS_ACCEPTANCE.md)
- [Hermes restart acceptance](docs/HERMES_RESTART_ACCEPTANCE.md)
- [dogfood and beta gate](docs/DOGFOOD.md)
- [remaining beta acceptance handoff](docs/BETA_ACCEPTANCE_HANDOFF.md)
- [release checklist](docs/RELEASE_CHECKLIST.md)
- [supported environment](docs/SUPPORTED_ENVIRONMENT.md)
- [compatibility policy](docs/COMPATIBILITY_POLICY.md)
- [changelog and migration notes](CHANGELOG.md)
- [maturity roadmap](PLAN.md)

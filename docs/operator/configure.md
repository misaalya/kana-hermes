# Configure Kana

Kana keeps optional server-side settings in one owner-only JSON file,
`config.json`, inside its data root. This page documents every key the file
accepts, its default, and how a change takes effect.

**Read when:** you need to change Kana's speech engine, tell it where Hermes is, or expose it on a network.
**Truth in code:** `lib/server/user-config.ts`, `config/default-config.json`, `lib/server/local-hermes-runtime.ts`, `lib/server/tts-provider/index.ts`

## The configuration file

The file is `$KANA_DATA_DIR/config.json` (see `install.md` for how the data root
is resolved). Kana creates it from its bundled defaults on the first start and
whenever Settings → Connection → Advanced configuration is opened; an existing
file is never overwritten. The file is written mode `0600` and its directory
`0700`. Recall it with:

```bash
kana config        # or npm run config in a checkout
```

With `$VISUAL` or `$EDITOR` set, Kana opens the file in that editor; otherwise
it prints the absolute path so it can be edited over SSH. Every key is optional,
so an empty file means the defaults, and unknown keys are ignored. Absolute paths
are required wherever a path is accepted, and a port must be between 1024 and
65535. An invalid file makes every integration that reads it fail honestly, and
Settings → Connection reports the message. Kana re-reads the file on each request
and caches the result until the file changes, so a saved edit needs no restart
except for `hermes.port`, which Kana captures when its own process starts.

The bundled starter file selects the local engine with `timeoutSeconds: 900`,
`steps: 16`, and `precision: "auto"`; other keys sit at their defaults. The same
settings are described for the person using Kana in the in-app guide at `/docs`
(`content/docs/configuration.en.md` and `configuration.id.md`, in formal English
and Indonesian baku); the two must not contradict each other, and where they
differ the code and this page decide.

## Deployment mode

| Key | Default | Effect |
| --- | --- | --- |
| `deployment.mode` | `"local"` | `"local"` answers only at `localhost`, `127.0.0.1`, and `[::1]` and returns 421 for any other host name, which blocks DNS rebinding. `"deployment"` is for a VPS, Nginx, or a network. |

Authentication is required in both modes. `KANA_DEPLOYMENT_MODE` overrides the
file, and `kana serve` sets that variable to `deployment` for the server it
starts, so the file's value is inert under `kana serve`. `KANA_TRUSTED_ORIGINS`
adds host names that a local-mode Kana also answers.

## Hermes

These keys matter only for a `hermes serve` that Kana itself starts. A gateway
that is already running keeps its own port and working directory, and Kana
adopts it instead.

| Key | Default | Effect |
| --- | --- | --- |
| `hermes.executable` | Found automatically | Absolute path to the `hermes` program. Set it only when `kana doctor` still cannot find Hermes. |
| `hermes.port` | `9119` | Port for the Hermes process Kana starts, 1024–65535. |
| `hermes.workingDirectory` | The home of the user running Kana | Absolute folder Hermes starts in; its file and terminal tools resolve relative paths there. |

```json
{ "hermes": { "port": 9120, "workingDirectory": "/home/you/projects" } }
```

`KANA_HERMES_BIN` overrides `hermes.executable` and must also be absolute. Kana
captures `hermes.port` when its own process starts, so restart Kana to apply it.

## Speech

`tts.provider` selects the server-side audio generator. The browser always uses
Kana's same-origin speech relay, playback cache, Web Audio decoder, and Live2D
lip sync, whichever provider is selected.

| Key | Default | Effect |
| --- | --- | --- |
| `tts.provider` | See below | `"irodori-local"` or `"pollinations"`. |
| `tts.timeoutSeconds` | `900` | Whole speech request, in seconds, including waiting behind another utterance. Accepts 1–3600. |
| `tts.irodoriLocal` | none | Local engine options. |
| `tts.pollinations` | none | Pollinations options. |

When `provider` is omitted, Kana selects `pollinations` if a `pollinations`
block or legacy external fields are present, and `irodori-local` otherwise.
Keeping both blocks is supported, but then `provider` is required. Only the
selected provider's block is read, so an inactive block is preserved on disk and
never affects validation or a request. For compatibility, `"qwen3-local"` selects
the local engine, and `"openai-compatible"` selects Pollinations only when its
`preset` is `pollinations`; any other generic endpoint is refused.

### The local voice engine

`irodori-local` speaks through the Irodori-TTS v4.1 Anime model on the irodori-c
CPU engine. It needs Linux on x86-64 with glibc 2.35 or newer and a CPU with AVX2
and FMA. CPUs with AVX-512 VNNI automatically use the faster int8 path.

| Key | Default | Effect |
| --- | --- | --- |
| `steps` | `16` | Euler sampling steps, 1–200. `8` is fastest; `40` is the engine's quality default. |
| `precision` | `"auto"` | `"auto"`, `"int8"`, or `"fp32"`; `"int8"` needs AVX-512 VNNI. |
| `threads` | Physical CPU cores | Engine threads, 1–256. |
| `modelPath` | none | Absolute path to an existing Irodori v4.1 `model.safetensors`; skips the model download. |
| `installDirectory` | `$KANA_DATA_DIR/irodori` | Absolute folder the engine and model are installed into. |

Nothing is downloaded when Kana starts, when the voice is off, or when another
provider is configured. Settings → Voice downloads the engine and assets (about
480 MB of archives) and the model (about 3.1 GB) only on request, into
`installDirectory`. The install needs roughly 4.3 GB of free disk while the
archives are staged, refuses to start when the disk is short, resumes an
interrupted download, and verifies every pinned file by size and SHA-256 before
use. A matching model in the Hugging Face cache (`$HF_HUB_CACHE`, `$HF_HOME/hub`,
or `~/.cache/huggingface/hub`) is verified once and used in place. Until it is
installed, speech fails immediately and the reply is shown as text.

Each utterance runs one short-lived engine process, serialized because it needs
1.4–2 GB of RAM. Long speech is split at sentence boundaries to fit the engine's
256-token/30-second limit and joined into one WAV. Kana's emotion picks a
Japanese speaking-style caption, and a library voice becomes the reference audio.

### Pollinations

Each external voice service is its own adapter shaped after that service's own
API. There is no generic "OpenAI-compatible" adapter, because speech APIs share
no common standard.

| Key | Default | Effect |
| --- | --- | --- |
| `apiKey` | required | A secret `sk_` key from [enter.pollinations.ai](https://enter.pollinations.ai/keys). Every Pollinations speech model is paid. |
| `model` | Pollinations' default | A speech model or alias from the live catalog, such as `elevenlabs`, `elevenlabs/eleven-flash-v2.5`, `qwen-tts-instruct`, or `x-ai/grok-tts`. |
| `voice` | Pollinations' default | One of the model's voices, or a custom ElevenLabs voice ID. |
| `instructions` | none | How to speak, for the models that take direction. |
| `format` | `"mp3"` | `"mp3"`, `"opus"`, `"aac"`, `"flac"`, or `"wav"`. |

```json
{
  "tts": {
    "provider": "pollinations",
    "pollinations": {
      "apiKey": "sk_YOUR_POLLINATIONS_KEY",
      "model": "elevenlabs",
      "voice": "rachel",
      "instructions": "A calm and gentle young anime girl voice.",
      "format": "mp3"
    }
  }
}
```

Kana posts `input`, `response_format`, and the configured `model`, `voice`, and
`instructions` to `https://gen.pollinations.ai/v1/audio/speech`, and nothing
else. A reply longer than Pollinations' 10,000-character limit is refused before
it is sent, a non-audio or empty response is rejected, and a generated file is
capped at 64 MB before the browser can buffer it. A `config.json` written when
Pollinations was a preset over the generic adapter (`"provider":
"openai-compatible"` with `"preset": "pollinations"`) keeps working and sounds
the same; rewriting it in the shape above is recommended.

The key belongs to the user and is read from the owner-only server file. It is
attached to the upstream `Authorization: Bearer` header and is never included in
browser preferences, provider status, diagnostics, backups, or a client-side
request, and Kana redacts it from any upstream error it shows.

## Environment variables

Set these in the environment that runs `kana` or `node server.js`, not in
`config.json`; they take precedence over the file. Speech settings deliberately
have no environment override.

| Variable | Effect |
| --- | --- |
| `KANA_DATA_DIR` | The data root. Must be absolute. A start never moves it; `kana migrate` copies it into the default `~/.kana` root on request (`install.md`). |
| `KANA_PORT` | Web port; equivalent to `kana --port`. `PORT` is also read. |
| `KANA_DEPLOYMENT_MODE` | `local` or `deployment`; overrides `deployment.mode`. |
| `KANA_JWT_SECRET` | Session-signing secret, at least 32 characters. When unset, Kana generates and reuses `jwt-secret` in the data root. |
| `KANA_HERMES_BIN` | Absolute path to Hermes; overrides `hermes.executable`. |
| `KANA_TRUSTED_ORIGINS` | Comma-separated extra origins, for a proxy that rewrites `Host` without forwarding `X-Forwarded-Host`, or a local-mode Kana under another name. |
| `KANA_DEV_ALLOWED_ORIGINS` | Development only: extra hosts allowed to reach `next dev`. |
| `AUTH_COOKIE_SECURE` | `true` marks session cookies `Secure` when the proxy cannot forward `X-Forwarded-Proto`. |

## Applying a change

Speech settings are resolved per request, so a saved edit applies to the next
request; a request already in flight keeps the provider that started it, and Kana
never falls back from one provider to the other. The `hermes` section takes
effect when Kana starts a Hermes process, and `hermes.port` is captured when
Kana itself starts, so restart Kana after changing it.

Changes on the Hermes side are separate, and `/restart` works only for a Hermes
that Kana started:

| Change | How it reaches Hermes |
| --- | --- |
| Models and providers in Hermes's `config.yaml` | At once; Hermes re-reads the file when its modification time changes. The composer's model list refreshes in the background. |
| `~/.hermes/.env` | After `/reload`, which runs Hermes's `reload.env`. |
| MCP servers | After `/reload-mcp now`; the first `/reload-mcp` asks for confirmation. |
| Skills | After `/reload-skills`. |
| Anything else Hermes reads only at startup | After `/restart`, which restarts the `hermes serve` Kana started and resumes the open conversation. |

## See also

- `install.md` for the data root, the first start, and both distribution paths.
- `supported-environment.md` for the tested platform and the reverse-proxy examples.
- `security.md` for the threat model that these network settings support.
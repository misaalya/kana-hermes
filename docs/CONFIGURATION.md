# Kana advanced configuration

Kana keeps technical runtime controls out of the everyday interface. Optional
self-hosting overrides live in one server-owned file:

```text
$KANA_DATA_DIR/config.json
```

The file is normal editable JSON owned by the account running Kana. Opening
Settings → Advanced configuration creates the starter file (mode `0600`) and
shows its absolute path. From a source checkout or global installation, run:

```bash
npm run config
# or, after a global install:
kana config
```

Kana opens the file with `$VISUAL`/`$EDITOR` when available; otherwise it
prints the exact path so it can be edited with any editor or over SSH. Creating
the file never overwrites existing data. Restart Kana after manual edits.

With the global package, the first `kana` launch creates this file from
[`config/default-config.json`](../config/default-config.json). The starter
selects the local Irodori voice engine, which is not downloaded until requested. Kana also
creates a separate owner-only JWT signing secret in the same data directory.
This happens on first launch rather than during `npm install -g`: npm may run
as root while Kana later runs as a normal user, so install-time state would
have the wrong owner and location. Both operations are safe to repeat and
preserve existing state.

When `KANA_DATA_DIR` is not set, Kana follows the same XDG/HOME data-directory
resolution used by authentication and the activity store. The Settings screen
shows the resolved absolute path for the current installation.

The complete starter file is:

```json
{
  "tts": {
    "provider": "irodori-local",
    "timeoutSeconds": 900,
    "irodoriLocal": {
      "steps": 16,
      "precision": "auto"
    }
  }
}
```

All override fields are optional. Paths must be absolute and ports must be
between 1024 and 65535.

## TTS providers

`tts.provider` selects only the server-side audio generator. The browser still
uses Kana's same-origin speech relay, playback cache, replay controls, Web
Audio decoder, and Live2D lip sync regardless of the selected provider.

The default is `irodori-local` when no TTS provider configuration is supplied.
`tts.provider` is the single explicit selector. You may keep both provider
blocks in the file and switch just this field: inactive fields are preserved
on disk and do not affect validation or requests for the selected provider.
If both blocks exist, the selector is required. For compatibility, an external
block by itself (or an old flat external config) still selects the external
adapter, and `"qwen3-local"` from builds that used the Qwen3-TTS service now
selects the local Irodori engine (its old `qwen3Local` block is ignored).

`tts.timeoutSeconds` defaults to **900 seconds** for the whole speech request,
including waiting behind another utterance. It accepts integers from 1 to 3600.
For VPS deployments set the reverse proxy read timeout above this value
(the example uses 910 seconds). Provider changes apply to new requests;
cancellation of an in-flight request still follows its original provider.
There is no automatic fallback between local and external providers.

### Local voice engine

`irodori-local` speaks with the
[Irodori-TTS v4.1 Anime](https://huggingface.co/phasefield-audio/Irodori-TTS-v4.1-Anime)
model on the [irodori-c](https://github.com/misaalya/irodori-c) CPU engine. It
needs Linux on x86-64 with glibc 2.35+ and an AVX2/FMA CPU; CPUs with AVX-512
VNNI use the faster int8 path automatically. No Python, PyTorch, or GPU is used.

**Nothing is downloaded until someone asks for it.** Starting Kana, turning
voice on, or opening Settings never downloads anything. The engine release
(~480 MB) and the model (~3.1 GB) are fetched only after Settings → Voice →
Download voice engine, into `$KANA_DATA_DIR/irodori`. Until then a speech
request fails immediately with "not installed" and the reply is shown as text.

- Every file is pinned by size and SHA-256 (see `shared/irodori-release.mjs`)
  and checked before use; a mismatch is deleted rather than run.
- Interrupted downloads resume where they stopped. Cancelling keeps the
  partial file for next time.
- The install is refused up front when the disk lacks the space it needs.
- If the pinned model already exists in the Hugging Face cache
  (`$HF_HUB_CACHE`, `$HF_HOME/hub`, or `~/.cache/huggingface/hub`), Kana
  verifies it once and uses it in place instead of downloading a copy.
- Remove deletes only what Kana downloaded; a cached or configured model stays.

Each utterance runs one short-lived engine process (serialized, since each
needs 1.4–2 GB of RAM). Long replies are split at sentence boundaries to fit
the engine's 256-token / 30-second limit and joined into one WAV. Kana's
emotion selects a Japanese speaking-style caption; a voice from the library is
passed as the engine's reference audio.

Optional fields under `tts.irodoriLocal`:

| Field | Default | Purpose |
| --- | --- | --- |
| `steps` | `16` | Euler sampling steps, 1–200: 8 is fastest, 40 is the engine's quality default |
| `precision` | `auto` | `auto` (int8 when the CPU has AVX-512 VNNI), `int8`, or `fp32` |
| `threads` | physical cores | Engine threads |
| `modelPath` | none | Absolute path to an existing Irodori v4.1 `model.safetensors`; skips the model download |
| `installDirectory` | `$KANA_DATA_DIR/irodori` | Where the engine and model are installed |

To use Pollinations, replace the `tts` section with:

```json
{
  "tts": {
    "provider": "openai-compatible",
    "openAiCompatible": {
      "preset": "pollinations",
      "apiKey": "YOUR_POLLINATIONS_API_KEY",
      "model": "qwen-tts-instruct",
      "voice": "Serena",
      "defaultInstruction": "A calm and gentle young anime girl voice. Soft, warm, soothing, natural Japanese speech.",
      "responseFormat": "wav"
    }
  }
}
```

The preset supplies `https://gen.pollinations.ai/v1` as its base URL and opts
into the non-standard `instruct` request field. Every shown value can still be
overridden. Pollinations is not a special playback implementation; it is a
preset over Kana's generic OpenAI-compatible `POST /v1/audio/speech` adapter.

For another compatible provider, configure the adapter directly:

```json
{
  "tts": {
    "provider": "openai-compatible",
    "openAiCompatible": {
      "baseUrl": "https://voice.example.com/v1",
      "apiKey": "YOUR_PROVIDER_API_KEY",
      "model": "tts-1",
      "voice": "alloy",
      "responseFormat": "mp3"
    }
  }
}
```

Kana sends only `model`, `input`, and `voice` by default (plus
`response_format` when configured). It sends the default instruction only when
the provider explicitly opts in through `instructionField`, for example
`"instructionField": "instruct"`. This keeps the generic adapter compatible
with providers that do not implement Pollinations' extension.

The API key belongs to the user. It is read from the owner-only server
`config.json`, attached to the upstream `Authorization: Bearer` header, and is
never included in browser preferences, provider status, diagnostics, backups,
or client-side requests. Remote providers require HTTPS and an API key;
credential-free HTTP is accepted only for loopback-compatible services.
Kana rejects empty or mislabeled responses and caps each generated audio file
at 64 MB before it can be buffered by the browser. The generic adapter also
limits a single speech input to 20,000 characters; provider presets may impose
a smaller upstream-specific limit (Pollinations currently uses 4,096).

Normally `hermes.executable` should be omitted. Kana searches the environment,
the full `PATH`, Hermes-managed homes/virtual environments, user-local and
system install paths, and Termux's prefix. Add the field only when `kana
doctor` still reports Hermes as not found. `KANA_HERMES_BIN` is the
environment-variable override and takes precedence over the JSON value.

`hermes.workingDirectory` is the folder Hermes starts in when Kana launches
`hermes serve`: its file and terminal tools resolve relative paths there. It
defaults to the home directory of the user running Kana (for example
`/home/kenobu`). Set an absolute path to point Hermes at a project folder
instead. It only applies to a Hermes process started by Kana; an already
running `hermes serve` keeps its own working directory.

`deployment.mode` is deliberately independent from Next.js' `NODE_ENV`:

- `local` means the browser reaches Kana only on the same machine. This is
  the default used by the global `kana` launcher.
- `deployment` means Kana is exposed through Nginx, a public/private network,
  a VPS, or another remote host. Authentication is mandatory for Hermes
  process controls and the voice engine download in this mode. Local mode also requires authentication.

`KANA_DEPLOYMENT_MODE=local|deployment` remains an operator-level deployment
override. `KANA_TRUSTED_ORIGINS` (comma-separated origins) is only needed when
a reverse proxy rewrites `Host` without forwarding `X-Forwarded-Host`.
`KANA_DEV_ALLOWED_ORIGINS` lists extra hosts allowed to reach `next dev`. `KANA_DATA_DIR` selects the single data root, and
`KANA_HERMES_BIN` can override Hermes discovery. TTS provider and local voice
settings intentionally have no environment-variable override; edit this JSON
instead. Provider selection is resolved per request, but restart Kana after
editing local runtime fields so every server worker agrees.


## Local computer versus VPS

Installation and deployment instructions are in [Install and deploy Kana](INSTALLATION.md).
The same config schema applies everywhere. The local voice engine runs on the
machine hosting Kana, including when that machine is a VPS. Config paths,
Hermes discovery, the voice engine download and API keys refer to that server, never to the
visitor's computer. The browser only calls same-origin Kana relay routes.
Speech text is held until playback starts; Web Audio drives the lip sync.
If synthesis/decoding/playback fails, Kana reveals the text with a visible
error. Stop reveals pending text and cancels its audio. Turning voice off
shows future replies immediately without sending TTS requests.

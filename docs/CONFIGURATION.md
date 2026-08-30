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
the file never overwrites existing data; `kana setup` only updates the TTS
provider section after explicit confirmation. Restart Kana after manual edits.

With the global package, the first `kana` launch creates this file from
[`config/default-config.json`](../config/default-config.json). The starter
selects local deployment and local Qwen3-TTS with safe CPU defaults. Kana also
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
  "deployment": {
    "mode": "local"
  },
  "tts": {
    "provider": "qwen3-local",
    "qwen3Local": {
      "port": 7860,
      "model": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
      "modelRevision": "5d83992436eae1d760afd27aff78a71d676296fc",
      "device": "cpu",
      "dtype": "auto",
      "attention": "sdpa",
      "maxCharacters": 1200,
      "maxNewTokens": 2048
    }
  }
}
```

All override fields are optional. Paths must be absolute and ports must be
between 1024 and 65535. Do not create a separate Qwen configuration file or
set `KANA_TTS_*` variables when Qwen is managed by Kana; Kana derives the
internal Python process environment from this JSON.

## TTS providers

`tts.provider` selects only the server-side audio generator. The browser still
uses Kana's same-origin speech relay, playback cache, replay controls, Web
Audio decoder, and Live2D lip sync regardless of the selected provider.

The default is `qwen3-local`, including when the `tts` section or `provider`
field is absent. Optional local-only fields belong under `tts.qwen3Local`:

| Field | Default | Purpose |
| --- | --- | --- |
| `projectDirectory` | bundled service | Override the Qwen service source directory |
| `uvExecutable` | auto-discovered | Absolute path to `uv` when discovery fails; Kana checks `PATH`, `~/.local/bin`, `~/.cargo/bin`, Termux, and system paths |
| `runtimeDirectory` | `$KANA_DATA_DIR/qwen-runtime` | Isolated Python environment |
| `cacheDirectory` | `$KANA_DATA_DIR/qwen3-tts-cache` | Downloaded model cache |
| `dataDirectory` | `$KANA_DATA_DIR/qwen3-tts` | Voice profiles and local service data |
| `port` | `7860` | Loopback service port |
| `model` / `modelRevision` | pinned official Base model | Hugging Face model and revision; `null` disables revision pinning |
| `device` | `cpu` | Torch device such as `cpu` or `cuda:0` |
| `dtype` | `auto` | `auto`, `float32`, `float16`, or `bfloat16` |
| `attention` | `sdpa` | Transformers attention implementation |
| `defaultVoice` | none | Fallback cloned voice profile ID |
| `maxCharacters` | `1200` | Per-request text limit |
| `maxNewTokens` | `2048` | Synthesis generation limit |

Kana starts Qwen lazily when voice is enabled and speech is first requested.
The npm launcher no longer has a separate `qwenEnabled` state and never starts
a competing Qwen process.

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

`deployment.mode` is deliberately independent from Next.js' `NODE_ENV`:

- `local` means the browser reaches Kana only on the same machine. This is
  the default used by the global `kana` launcher.
- `deployment` means Kana is exposed through Nginx, a public/private network,
  a VPS, or another remote host. Authentication is mandatory for Hermes and
  Qwen process controls in this mode.

`KANA_DEPLOYMENT_MODE=local|deployment` remains an operator-level deployment
override. `KANA_DATA_DIR` selects the single data root, and
`KANA_HERMES_BIN` can override Hermes discovery. TTS provider and Qwen runtime
settings intentionally have no environment-variable override; edit this JSON
instead. Provider selection is resolved per request, but restart Kana after
editing local runtime fields so every server worker agrees.

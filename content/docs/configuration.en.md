# Configuration guide

> Configure Kana's voice engines, Hermes, and network access in a single JSON file. Every setting is optional; without changes, Kana runs on its defaults.

**Config file:** `config.json` in Kana's data folder. On this installation:

```kana-config-path
~/.local/share/kana/config.json
```

**Open it:** run `kana config`, or `npm run config` from a source checkout. The command creates the file if it does not exist (an existing file is never overwritten) and opens it in the editor set in `VISUAL` or `EDITOR`. When neither is set, it prints the file's location instead.

**Apply changes:** save the file. Changes take effect from the next reply without a restart, except for the `hermes` section.

**Check for errors:** open **Settings → Connection**. Anything in `config.json` that needs fixing is reported there.

## Quick start {#quickstart}

### Local voice (default)

```json
{
  "tts": {
    "provider": "irodori-local"
  }
}
```

Download the voice engine first from **Settings → Voice → Download voice engine**.

### Pollinations (ElevenLabs)

```json
{
  "tts": {
    "provider": "pollinations",
    "pollinations": {
      "apiKey": "sk_YOUR_POLLINATIONS_KEY",
      "model": "elevenlabs/eleven-v3",
      "voice": "rachel"
    }
  }
}
```

### Pollinations with style direction (Qwen TTS)

```json
{
  "tts": {
    "provider": "pollinations",
    "pollinations": {
      "apiKey": "sk_YOUR_POLLINATIONS_KEY",
      "model": "qwen/qwen3-tts-instruct-flash",
      "instructions": "A calm, gentle voice."
    }
  }
}
```

### Slower computers (Irodori)

```json
{
  "tts": {
    "provider": "irodori-local",
    "timeoutSeconds": 1800,
    "irodoriLocal": {
      "steps": 8,
      "threads": 4
    }
  }
}
```

### Server or VPS

```json
{
  "deployment": {
    "mode": "deployment"
  }
}
```

Every key and its default is described in the sections below.

## Voice engines {#voice}

The `tts` section selects the voice engine and limits how long speech may take.

| Engine | `provider` | Best for |
| --- | --- | --- |
| Local voice (Irodori) | `"irodori-local"` | Free, offline use. Runs on your CPU. |
| Pollinations | `"pollinations"` | Less powerful computers. Requires internet access and a paid API key. |

| Key | Default | Description |
| --- | --- | --- |
| `provider` | See description | `"irodori-local"` or `"pollinations"`. When omitted, Kana uses `"pollinations"` if only a `pollinations` block is present, and `"irodori-local"` otherwise. Required when both `irodoriLocal` and `pollinations` are present. |
| `timeoutSeconds` | `900` | Maximum time to generate speech for one reply, in seconds, including time spent queued. Accepts 1–3600. |
| `irodoriLocal` | None | Local voice options. See Local voice (Irodori). |
| `pollinations` | None | Pollinations options. See Pollinations. |

Only the selected engine's block is read, so settings for both engines can stay in the same file.

> **Note:** if speech cannot be generated, the reply is still shown as text together with the error. Kana never falls back to the other engine.

### Timeouts

Raise `timeoutSeconds` if speech for long replies fails because the time limit runs out. Behind Nginx or another reverse proxy, set the proxy's read timeout slightly higher, for example 910 seconds for the default of 900.

```json
{
  "tts": {
    "timeoutSeconds": 1800
  }
}
```

## Local voice (Irodori) {#irodori}

Generates speech on your CPU with the [Irodori-TTS v4.1 Anime](https://huggingface.co/phasefield-audio/Irodori-TTS-v4.1-Anime) model. No GPU is required, and reply text never leaves your computer.

**Requirements:** 64-bit Linux on x86-64 with glibc 2.35 or later (such as Ubuntu 22.04) and a CPU with AVX2 and FMA.

**Install:** open **Settings → Voice** and select **Download voice engine**. The download size and required disk space are shown first, and nothing is downloaded until you select the button.

**Interrupted downloads:** select the button again to resume where the download stopped.

**Existing models:** a copy already in your Hugging Face cache is used without downloading it again.

These keys go inside `tts.irodoriLocal`. All of them are optional.

| Key | Default | Description |
| --- | --- | --- |
| `steps` | `16` | Sampling steps, 1–200. Lower is faster; higher sounds smoother. `8` is the fastest; `40` matches the engine's standard quality. |
| `threads` | Number of CPU cores | CPU threads to use, 1–256. Lower it if your computer becomes sluggish while Kana is speaking. |
| `precision` | `"auto"` | `"auto"`, `"int8"`, or `"fp32"`. `"auto"` picks the fastest option for your CPU; `"int8"` requires AVX-512 VNNI. |
| `modelPath` | None | Absolute path to an existing Irodori v4.1 `model.safetensors`. |
| `installDirectory` | Kana's data folder | Absolute path to the folder the voice engine is installed in. |

> **Note:** on a less powerful computer, set `steps` to `8`. Speech sounds slightly less smooth but is ready sooner.

## Pollinations {#pollinations}

Generates speech with [Pollinations](https://gen.pollinations.ai/docs), a hosted service that offers models from ElevenLabs, Qwen, xAI, and others through one API key. It adds no load to your computer.

**Get your API key:** [enter.pollinations.ai](https://enter.pollinations.ai/keys). Use a secret key that starts with `sk_`. Every speech model is paid from your pollen balance.

**Models and voices:** [gen.pollinations.ai/audio/models](https://gen.pollinations.ai/audio/models)

**Speech models:** `elevenlabs/eleven-v3`, `elevenlabs/eleven-flash-v2.5`, `elevenlabs/eleven-multilingual-v2`, `qwen/qwen3-tts-instruct-flash`, `qwen/qwen3-tts-flash`, `x-ai/grok-tts`, `hexgrad/kokoro-82m`

These keys go inside `tts.pollinations`.

| Key | Required | Description |
| --- | --- | --- |
| `apiKey` | Yes | Your Pollinations API key. It is stored only on the computer or server running Kana and is never sent to the browser. |
| `model` | No | A model ID from the catalog, such as `elevenlabs/eleven-v3`. Aliases such as `elevenlabs` still work. When omitted, Pollinations uses its default model. |
| `voice` | No | One of the model's voices, or the ID of one of your own ElevenLabs voices. When omitted, Pollinations uses its default voice. |
| `instructions` | No | Speaking-style direction for models that support it, such as `qwen/qwen3-tts-instruct-flash`. |
| `format` | No | `"mp3"` (default), `"opus"`, `"aac"`, `"flac"`, or `"wav"`. |

With the low-latency ElevenLabs model:

```json
{
  "tts": {
    "provider": "pollinations",
    "pollinations": {
      "apiKey": "sk_YOUR_POLLINATIONS_KEY",
      "model": "elevenlabs/eleven-flash-v2.5",
      "voice": "rachel",
      "format": "mp3"
    }
  }
}
```

> **Note:** a single reply is limited to 10,000 characters. Longer replies are not sent to Pollinations and are shown as text with an error.

**Older configurations:** `"provider": "openai-compatible"` with the Pollinations preset still works and produces the same voice. Rewriting it in the format above is recommended.

## Hermes {#hermes}

Hermes is the AI agent that reads your messages and writes Kana's replies. Kana finds and starts it automatically; the `hermes` section is needed only when Hermes cannot be found, the default port is taken, or Hermes should work in a particular folder.

| Key | Default | Description |
| --- | --- | --- |
| `executable` | Found automatically | Absolute path to the `hermes` program. Set it only if `kana doctor` still cannot find Hermes. |
| `port` | `9119` | Port for the Hermes process Kana starts, 1024–65535. |
| `workingDirectory` | Your home folder | Absolute path to the folder Hermes starts in. Hermes' file and terminal tools resolve relative paths from here. Applies only when Kana starts Hermes. |

```json
{
  "hermes": {
    "port": 9120,
    "workingDirectory": "/home/you/projects"
  }
}
```

> **Note:** changes to the `hermes` section take effect after Kana is restarted.

## Network access {#deployment}

The `deployment` section describes how Kana is reached.

| `mode` | Use when |
| --- | --- |
| `"local"` (default) | Kana is opened on the computer it runs on. |
| `"deployment"` | Kana is reached through a VPS, Nginx, or a network, for example from a phone. |

```json
{
  "deployment": {
    "mode": "deployment"
  }
}
```

Kana always asks for a password, in both modes.

## Environment variables {#environment}

For server installations. Set these in the environment that runs `kana`, not in `config.json`; they take precedence over the file.

| Variable | Description |
| --- | --- |
| `KANA_DATA_DIR` | Kana's data folder, which holds `config.json` and the voice engine. When unset, Kana uses `$XDG_DATA_HOME/kana`, then `~/.local/share/kana`. |
| `KANA_PORT` | Port for Kana's web page. Defaults to `3000`; equivalent to `kana --port`. |
| `KANA_DEPLOYMENT_MODE` | `local` or `deployment`. Overrides `deployment.mode`. |
| `KANA_HERMES_BIN` | Path to the Hermes program. Overrides `hermes.executable`. |
| `KANA_TRUSTED_ORIGINS` | Additional trusted origins, comma-separated. Needed only when a proxy rewrites the `Host` header without forwarding `X-Forwarded-Host`. |
| `KANA_DEV_ALLOWED_ORIGINS` | Development only: additional hosts allowed to reach `next dev`. |

```sh
KANA_DATA_DIR=/var/lib/kana KANA_PORT=3000 kana serve
```

Voice settings have no environment variables; change them in `config.json`.

## Troubleshooting {#troubleshooting}

| Symptom | Fix |
| --- | --- |
| **Settings → Connection** reports an error in `config.json` | Correct the key named in the message and save the file. |
| Hermes cannot be found | Run `kana doctor`. If the problem remains, set `hermes.executable` or `KANA_HERMES_BIN`. |
| Port 9119 is used by another program | Change `hermes.port`, then restart Kana. |
| Speech for long replies fails because the time limit runs out | Raise `tts.timeoutSeconds`, and your proxy's timeout if you use one. |
| `Pollinations returned HTTP 401` | The API key is missing or invalid. Check `tts.pollinations.apiKey`. |
| `Pollinations returned HTTP 402` | Your pollen balance is too low. Top it up at [enter.pollinations.ai](https://enter.pollinations.ai). |

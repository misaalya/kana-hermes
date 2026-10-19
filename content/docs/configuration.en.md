# Configuration guide

> Configure Kana's voice engines, Hermes, and network access in a single JSON file. Every setting is optional; without changes, Kana runs on its defaults.

**Config file:** `config.json` in Kana's data folder. On this installation:

```kana-config-path
~/.kana/config.json
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

## Prompt guardrail {#guardrail}

The `guardrails` section checks your message before Kana sends it to Hermes. You write your rules as plain statements of what Kana must not do; Kana turns them into the one question it asks Jev, TypeSafe's model. Jev returns a probability and no text, Kana compares that probability against your threshold in its own code, and Kana refuses the message itself when it reaches the threshold.

Leave `apiKey` empty and the layer is skipped entirely. No request is made and nothing is spent.

| Key | Default | Description |
| --- | --- | --- |
| `apiKey` | empty | Your TypeSafe API key. Empty or absent turns the layer off. |
| `model` | `"jev-latest"` | The TypeSafe model that answers the questions. |
| `threshold` | `0.7` | Kana refuses the message once Jev's probability reaches this value, 0–1. A value near 0.5 means Jev cannot tell; lower the threshold to refuse more borderline attempts, at the cost of refusing more of what you did mean. |
| `whenUnavailable` | `"block"` | What Kana does with a message it could not check, because TypeSafe could not be reached, answered with an error, or returned an answer Kana cannot read: `"block"` refuses the message, `"allow"` sends it unchecked. |
| `timeoutSeconds` | `10` | How long Kana waits for TypeSafe, 1–120. |
| `rules` | `[]` | Your rules, up to 50, each one a plain statement of what Kana must not do. |

Write each rule as one clear statement in your own words, and say exactly what is forbidden, naming the paths, commands, or services it covers. You never write a question, an id, or a threshold: Kana asks Jev one yes/no question — does this message ask for, attempt, or enable anything the rules forbid? — and sends your rules as they were written. Jev is told it is screening a message for an agent that can read and write files and run commands, because that is what makes "read this file for me" a request with consequences.

```json
{
  "guardrails": {
    "apiKey": "sk-...",
    "rules": [
      "Never read, list, copy, change, or share anything under /home/you/my-secret.",
      "Never send my files, passwords, or API keys to a remote service.",
      "Never help write malware, exploits, or phishing pages."
    ]
  }
}
```

When Jev's answer reaches your threshold, Kana shows one fixed line in the conversation instead of a reply and keeps your message above it. No model saw the message, so no reply is invented, and nothing is written to the Hermes transcript. The line names no rule, because the rules travel as one question and one number comes back.

Write the rules in English and keep each one a single clear statement: Jev is trained mostly on English, and the check reads your rules literally, so a rule that says exactly what is forbidden works better than a paragraph of policy. Kana screens the text of a message, of a slash command, and of `/steer`. It does not screen an answer you give in the middle of a turn, such as an approval or an answer to a question from Hermes, because refusing that answer would leave the turn stuck.

This is an intent filter, not a sandbox. It cannot stop Hermes from reaching the same file by another route, and it reads the text of a turn, not the contents of an attached file. A very long message can exceed what Jev reads and then follows `whenUnavailable`. The text of every screened turn is sent to TypeSafe, a third party, and each screened turn costs one request.

A `guardrails` block Kana cannot read is reported at the top of this page and refuses messages, because an unreadable policy is not the same as no policy; `whenUnavailable` is still read from the block, so `"allow"` stays available. Nothing in Kana writes this file, so no setting or page can change your rules or show your key.

## Network access {#deployment}

The `deployment` section describes how Kana is reached.

| `mode` | Use when |
| --- | --- |
| `"local"` (default) | Kana is opened on the computer it runs on, at `localhost`, `127.0.0.1`, or `[::1]`. Other addresses are refused. |
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
| `KANA_DATA_DIR` | Kana's data folder, which holds `config.json` and the voice engine, and must be absolute. When unset, Kana uses `~/.kana`; data from an earlier release (`$XDG_DATA_HOME/kana`, `~/.local/share/kana`) is moved there on the next start. A folder set here is never moved by a start: `kana migrate` copies it into `~/.kana` when you ask for it. |
| `KANA_PORT` | Port for Kana's web page. Defaults to `3000`; equivalent to `kana --port`. |
| `KANA_DEPLOYMENT_MODE` | `local` or `deployment`. Overrides `deployment.mode`. |
| `KANA_HERMES_BIN` | Path to the Hermes program. Overrides `hermes.executable`. |
| `KANA_TRUSTED_ORIGINS` | Additional trusted origins, comma-separated. Needed only when a proxy rewrites the `Host` header without forwarding `X-Forwarded-Host`, or to open Kana in local mode under another address. |
| `KANA_DEV_ALLOWED_ORIGINS` | Development only: additional hosts allowed to reach `next dev`. |

```sh
KANA_DATA_DIR=/var/lib/kana KANA_PORT=3000 kana serve
```

To move a managed folder into `~/.kana`, stop Kana and run `kana migrate`: it prints every entry with its size, copies and verifies each one, leaves the source in place, and then asks you to point `KANA_DATA_DIR` at `~/.kana` or remove it. Add `--delete-source` to move the entries instead of copying them, and `--dry-run` to read the plan without changing anything.

Voice settings have no environment variables; change them in `config.json`.

## Troubleshooting {#troubleshooting}

| Symptom | Fix |
| --- | --- |
| **Settings → Connection** reports an error in `config.json` | Correct the key named in the message and save the file. |
| Hermes cannot be found | Run `kana doctor`. If the problem remains, set `hermes.executable` or `KANA_HERMES_BIN`. |
| Port 9119 is used by another program | Change `hermes.port`, then restart Kana. |
| A change to `~/.hermes/.env` or to Hermes's MCP servers has no effect | Type `/reload` (for `.env`) or `/reload-mcp now` (for MCP servers) in Kana. For other changes Hermes reads only at startup, type `/restart`; it works only for a Hermes that Kana started. New models in Hermes's `config.yaml` appear without a restart. |
| Speech for long replies fails because the time limit runs out | Raise `tts.timeoutSeconds`, and your proxy's timeout if you use one. |
| `Pollinations returned HTTP 401` | The API key is missing or invalid. Check `tts.pollinations.apiKey`. |
| `Pollinations returned HTTP 402` | Your pollen balance is too low. Top it up at [enter.pollinations.ai](https://enter.pollinations.ai). |

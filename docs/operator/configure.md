# Configure Kana

Kana keeps optional server-side settings in one owner-only JSON file,
`config.json`, inside its data root. This page documents every key the file
accepts, its default, and how a change takes effect.

**Read when:** you need to change Kana's speech engine, screen prompts before they reach Hermes, tell it where Hermes is, or expose it on a network.
**Truth in code:** `lib/server/user-config.ts`, `lib/server/remote-hermes.ts`, `lib/server/remote-hermes-auth.ts`, `lib/server/instabox-wake.ts`, `lib/guardrails/policy.ts`, `config/default-config.json`, `lib/server/local-hermes-runtime.ts`, `lib/server/tts-provider/index.ts`

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
that is already running keeps its own port and working directory; Kana adopts
it when its session token can be read from the process environment, and
otherwise the connection screen asks for that process to be stopped so Kana can
start Hermes itself.

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

### Remote Hermes

By default Kana discovers or starts Hermes on the same machine. To use a Hermes
on another machine, add a `hermes.remote` block. Its presence selects remote
mode: Kana never discovers, adopts, starts, restarts, or stops a local Hermes,
and `hermes.executable`, `hermes.port`, and `hermes.workingDirectory` are
ignored. Removing the block returns Kana to local discovery.

```json
{
  "hermes": {
    "remote": {
      "url": "wss://hermes.example.com",
      "auth": {
        "mode": "password",
        "username": "misa",
        "passwordEnv": "HERMES_REMOTE_PASSWORD"
      },
      "instabox": {
        "machineId": "m_xxxxxxxx",
        "executable": "/home/you/.local/bin/instabox",
        "timeoutSeconds": 120
      }
    }
  }
}
```

| Key | Default | Effect |
| --- | --- | --- |
| `hermes.remote.url` | required | `wss://` dashboard URL. A bare host or base path gets `/api/ws` appended. Credentials, query strings, and fragments are refused. |
| `hermes.remote.auth.mode` | `"password"` | The only supported remote auth mode. |
| `hermes.remote.auth.username` | required | Username for Hermes's dashboard `basic` provider. |
| `hermes.remote.auth.password` | none | Password stored in this owner-only file. Exactly one of `password` and `passwordEnv` is required. |
| `hermes.remote.auth.passwordEnv` | none | Name of a dedicated environment variable holding the password; read by the server at connect time. Names starting with `KANA_` or `HERMES_DASHBOARD_SESSION_TOKEN` are refused. |
| `hermes.remote.instabox` | none | Optional Instabox wake, described below. |
| `hermes.remote.instabox.machineId` | required with `instabox` | Instabox machine id; letters, digits, dots, dashes, and underscores only. |
| `hermes.remote.instabox.executable` | `instabox` on `PATH` | Absolute path to the Instabox CLI. Its file name must be `instabox`. |
| `hermes.remote.instabox.timeoutSeconds` | `120` | How long to wait for the VM and Hermes health, 10–600 seconds. |
| `hermes.remote.instabox.env` | none | Extra environment variable names passed to the Instabox CLI, at most 32. Kana's own variables and the Hermes dashboard token are refused. |

The block was named `hermes.remote.wake` in earlier builds; Kana now rejects
that key with a rename error instead of guessing.

A non-loopback Hermes dashboard requires a login provider; configure its
`basic` provider with `HERMES_DASHBOARD_BASIC_AUTH_USERNAME` and a password or
password hash, then expose it over TLS. Kana logs in at
`/auth/password-login`, keeps the returned cookie in server memory, and asks
`/api/auth/ws-ticket` for a fresh single-use ticket before every WebSocket
connection. The password and cookie never reach the browser. Remote token auth
is not supported; `hermes.remote.token` is refused.

The remote host must expose `/auth/password-login`, `/api/auth/ws-ticket`,
`/api/ws`, and `/api/health`. Use HTTPS; basic auth over plain HTTP is not suitable for a
public host. The connection screen and Settings report remote mode without
exposing the URL, username, password, or a process control that cannot work.
`/restart` explains that the remote gateway must be restarted where it runs.

The Connection Host card and the desktop host monitor read the remote
dashboard's `/api/system/stats` with the same login cookie. They show the
remote hostname, CPU, memory, disk, and uptime plus the Hermes process RSS;
samples are cached for 2.5 seconds on the Kana server. The server clock in the
header remains Kana's clock.

A reply from a remote Hermes may still carry `MEDIA:/path`; that path is on the
remote machine. Kana keeps only the file name as text, never signs a path on its
own disk, and offers no download for it.

#### Instabox wake

When the gateway is an Instabox VM that pauses while idle, set
`hermes.remote.instabox`. The connection screen then offers **Wake Instabox**.
Kana runs exactly `instabox resume <machineId>` and, if that fails because the
sandbox is stopped, `instabox start <machineId>` with no shell, then polls the
gateway's `/api/health` until it answers or the timeout expires. It runs from
the service account's home with a small environment allowlist; add names such
as `INSTABOX_TOKEN` to `instabox.env` if the CLI needs them. The route is
authenticated, accepts no input from the browser, runs one wake at a time, and
refuses another for 15 seconds after one finishes. Kana never wakes a VM
automatically.

While the gate waits, it reads the machine through the same route with the
read-only `instabox get <machineId> --json`, using the same fixed arguments and
environment. That read exposes only the machine's `state` and whether its
runtime is `ready`; when the machine is already awake the action shows
**Instabox is awake** and stays disabled. The wake command's output is
discarded.

Waking or starting the VM restores its processes; it does not start
`hermes serve`. Run `hermes serve` as a service on the VM (for example a systemd
user service enabled at boot) so the health poll can succeed after a resume. A
running VM whose Hermes is stopped cannot be fixed by the wake command, and
Kana reports the timeout instead of claiming success.

The gate treats a paused VM as an ordinary state rather than a failure: it says
**Remote Hermes is unreachable**, makes **Wake Instabox** the primary action,
shows **Waking Instabox** while the request runs, and, if the wake succeeds but
Kana still cannot connect, points at the remote dashboard credentials instead
of repeating the same failure. Once the VM is awake the action is disabled and
reads **Instabox is awake**; **Connect again** keeps owning the connection
attempt.

The CLI must be installed and logged in on the machine that runs Kana, not on
the Instabox VM. A different host, such as a serverless platform, cannot run
this command; put Kana on an always-on server or use an external wake service.
The remote gateway and its reverse proxy must allow a request long enough for
`timeoutSeconds`.

#### Hosting note

Remote Hermes does not make Kana serverless. Kana still needs one long-lived
Node.js process with a writable data root for the shared gateway socket, SSE
streams, SQLite state, and the wake CLI. Vercel and similar function platforms
are not supported hosts.

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
A slow engine run can outlast a tunnel's deadline for the first response
headers, so the relay sends the 44-byte WAV head as soon as the install and
platform checks pass and streams the speech when it is ready; the browser
restores the head's sizes before playback. A failure after that point is logged
by the Kana server, because the HTTP status has already been sent.

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

## Prompt guardrail

The `guardrails` block does two things with the same rules. Kana carries the
rules in the prompt note it sends to Hermes on every turn, so the model sees the
owner's standing instructions; and, when a TypeSafe key is set, Kana also screens
the user's own text against them before the turn reaches Hermes. The rules
belong entirely to the owner: the block lives in `config.json`, which Kana
creates once and never rewrites, so no setting, route, or browser request can
change the rules or read the key.

The screen is off unless `guardrails.apiKey` is set. With an empty key — which
is what a new `config.json` ships — or with a key and no rules, Kana sends no
screening request. A blank key is the screen being off, not a broken block, so
the rules Kana ships with never refuse a turn before you set a key. The rules
themselves still ride in the prompt: with no key they are instructions to the
model, and with a key they are also the policy Jev enforces.

| Key | Default | Effect |
| --- | --- | --- |
| `guardrails.apiKey` | empty | The TypeSafe API key. Empty or absent turns the layer off. |
| `guardrails.model` | `"jev-latest"` | The TypeSafe model that answers the questions. |
| `guardrails.threshold` | `0.7` | Kana refuses the turn once Jev's probability reaches this value, 0 to 1. A value near 0.5 means Jev cannot tell; lower the threshold to refuse more borderline attempts, at the cost of refusing more of what you did mean. |
| `guardrails.whenUnavailable` | `"block"` | `"block"` refuses a turn Kana could not check; `"allow"` forwards it unchecked. Must be one of those two. |
| `guardrails.timeoutSeconds` | `10` | The whole screening request, 1 to 120. |
| `guardrails.rules` | five starter rules | Up to 50 rules, each one a plain statement of what Kana must not do. Every rule is carried in each prompt Kana sends Hermes, and screened by Jev when a key is set. |

```json
{
  "guardrails": {
    "apiKey": "sk-...",
    "whenUnavailable": "block",
    "rules": [
      "Never read, list, copy, change, or share anything under /home/you/my-secret.",
      "Never send my files, passwords, or API keys to a remote service.",
      "Never help write malware, exploits, or phishing pages."
    ]
  }
}
```

Each rule is one statement in your own words that names exactly what is
forbidden — the paths, commands, or services it covers. A new `config.json`
ships five starter rules and an empty key, so no screening request runs until
you add a key; replace the starters with your own, or keep the ones you agree
with. Those rules are not inert in the meantime: the relay reads the list on
every turn and places it inside Kana's own `<kana>` note in the prompt, so a
model that follows its instructions avoids the forbidden action. That is a
prevention layer, not the control: a model can be talked past it, which is why
the Jev screen exists. The relay reads the file per turn, so a rule you add or
edit applies to the next message without a restart, and the note is stripped
from the transcript by `unwrapKanaUserPrompt`, so a restored conversation never
shows the rules as something you typed.

For the screen, you write no question, no question id, and no per-rule
threshold: Kana turns the rules into the one question it asks Jev, TypeSafe's
System One model, which is whether the message asks for, attempts, or enables
anything the rules forbid. The rules travel as the question's data, the message
travels as the state, and Jev is told it is screening a message for an agent
that can read and write files and run commands. Jev is not a language model: it
returns a probability and no text, Kana never asks it to write, and the returned
probability is compared against the threshold in Kana's own code. A probability
at or above the threshold, or a guardrail that cannot run while
`whenUnavailable` is `"block"`, refuses the turn before it reaches the bridge.
Nothing is forwarded, so nothing is written to the Hermes transcript, and Kana
shows its own fixed sentence instead of a reply. That sentence names no rule:
the rules travel as one question, so one number comes back, and Kana does not
invent an attribution it did not ask for.

The screen covers the text a turn starts with: a chat message, a slash command
with its arguments, and `/steer`. It does not cover an approval or an answer to a
question from Hermes in the middle of a turn, and it reads the text of a turn
rather than the contents of an attached file. It is an intent filter, not a
sandbox: it cannot stop Hermes from reaching the same file by another route.

Two consequences follow from setting a key. The text of every screened turn is
sent to TypeSafe, which is a third party, and each screened turn costs one
request whatever the number of rules, because the rules are data inside one
question. Write the rules in English: Jev is trained mostly on English, so rules
in English judging text in another language are the arrangement it was built for.

An invalid `guardrails` block is reported rather than ignored. The config guide
at `/docs`, linked from Settings → Connection → Advanced configuration, shows
whether the screen is on and how many rules it would send, or the message
describing what is wrong with the block. While the block cannot be read, Kana
refuses turns, because an unreadable policy is not the same as no policy; the
`whenUnavailable` value is still read from the block, so `"allow"` remains
available as the way out. The prompt note reads rules at the same time and is
more tolerant: entries it can read still reach the model, and a malformed entry
is left out rather than stopping the turn. `GET /api/kana/config` reports that
state and never the key or the text of a rule.

`config.json` is the owner's file, not Kana's: Kana creates it once and never
rewrites it, but Hermes runs as the same user and can change it if a turn goes
wrong. To stop that, lock the file with the operating system's immutable flag —
`sudo chattr +i ~/.kana/config.json`, lifted with `chattr -i` before an edit —
which no process can write through, including Hermes. `security.md` has the
procedure and its limits.

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

## Adding or editing a model provider

Settings → AI providers, also linked from a row under the AI model controls,
lists each custom endpoint. A provider is one OpenAI-compatible endpoint: a
name, base URL, and key. One provider can serve many models, so the list shows
each provider once and opens a detail page with its models.

- **Add model** on a provider asks only for the model ID and optional context
  length; the provider's URL and key are reused.
- **Edit** changes that provider's name, base URL, or key, and lists the current
  model IDs read-only so the scope of the change is visible. Leave the key empty
  to keep the saved one. The provider's id stays the same when its display name
  changes, so existing selections keep working.
- **New provider** asks for the endpoint and its first model, because Hermes
  requires a model when the endpoint is created. More models can follow.

Hermes has no API to rename or remove a model ID. Each model ID in the detail
page is an editable pill: change it, press the save icon beside it, and Kana
warns that Hermes cannot rename before **Add as new** writes anything. Saving
adds the new ID alongside the original, which remains available. To retire an
ID, remove it in Hermes's own configuration; Kana does not edit that file.

If a provider answers `Invalid inference request` while the same model works
in another client, check the reasoning effort before the input size. Some
OpenAI-compatible providers accept only a subset of Hermes's levels, and Hermes
sends the active effort as a request parameter. Run `/reasoning high` or
`/reasoning none` in that Kana conversation; Kana commits the choice to the
serving Hermes session. A per-model `agent.reasoning_overrides` entry in
Hermes's `config.yaml` keeps the choice for new sessions too.

Kana sends these changes to Hermes's own dashboard API and never edits
`config.yaml` or `.env` itself. Use the API root for the base URL, such as
`https://api.example.com/v1`. If you paste the full `.../v1/chat/completions`
endpoint, Kana removes the trailing `/chat/completions` before sending it,
because the OpenAI client appends that path itself. A base URL that already ends
with a longer path is left alone.

The panel needs a gateway Kana can authenticate to the way it already does for
chat: locally, the `hermes serve` Kana started or adopted with a readable session
token; remotely, the dashboard login Kana keeps on the server. A key you enter is
sent once to Hermes, which stores it in its own `.env` behind `key_env`; Kana
neither stores nor shows it again. Hermes's synthetic direct-configuration entry
(the one that mirrors `model.provider: custom`) is the exception: its key lives
in the `model` block where this API cannot read it, so re-enter the key when
editing that entry, or the provider entry would shadow the working credential.

The save never changes the active model and never changes Kana's default: the
model appears in the composer's picker after the catalog refresh, and you choose
it (and optionally **Set as default**) in the usual way. Saving a model that
already exists is harmless. After a successful save Kana tries to restart the
managed local `hermes serve` so the endpoint and key are loaded, then reconnects
the open conversation. It does not restart while a turn is running, for a remote
Hermes, for one Kana did not start, or when it is stopped; the provider status
line says whether it restarted and what to do when it did not, and a failed
restart is shown as an error. The provider list is cached in server memory for 15
seconds; a create or update clears that cache, so the manager shows the change
immediately and other clients see an external Hermes edit within that window.

Hermes's dashboard API covers the modern `providers:` mapping but not named
entries in the legacy `custom_providers:` list. Those entries still appear in
the model picker; to add a model to one, edit that list in the Hermes
configuration where it lives, or create a new provider through this panel.

## Applying a change

Speech settings are resolved per request, so a saved edit applies to the next
request; a request already in flight keeps the provider that started it, and Kana
never falls back from one provider to the other. The `guardrails` block is read
on each turn, so a saved rule applies to the next message. The `hermes` section
takes effect when Kana starts a Hermes process, and `hermes.port` is captured
when Kana itself starts, so restart Kana after changing it.

Changes on the Hermes side are separate, and `/restart` works only for a Hermes
that Kana started:

| Change | How it reaches Hermes |
| --- | --- |
| Models and providers in Hermes's `config.yaml` | At once; Hermes re-reads the file when its modification time changes. The composer's model list refreshes in the background. |
| `~/.hermes/.env` | After `/reload`, which runs Hermes's `reload.env`. |
| MCP servers | After `/reload-mcp now`; the first `/reload-mcp` asks for confirmation. |
| Skills | After `/reload-skills`. |
| Anything else Hermes reads only at startup | After `/restart`, which restarts the `hermes serve` Kana started and resumes the open conversation. |

Kana's own default model for new conversations is an installation preference
in `appstate.db`, kept separately for each Hermes runtime (`local`, or an
opaque identity for the configured remote dashboard). Every browser that talks
to this Kana server sees the same map, so a phone and a laptop open new
conversations on the same model. Before Kana sends it to `session.create`, it
checks the connected Hermes's live model catalog; a provider or model that this
Hermes no longer offers is dropped for that session, Kana says so, and Hermes's
own default is used instead. Switching to another Hermes therefore never sends
a provider that exists only on the previous one.

## See also

- `install.md` for the data root, the first start, and both distribution paths.
- `supported-environment.md` for the tested platform and the reverse-proxy examples.
- `security.md` for the threat model that these network settings support.
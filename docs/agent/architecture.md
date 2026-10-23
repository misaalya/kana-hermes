# Architecture

Kana is the presentation and persona layer in front of the user's existing
Hermes Agent installation. The browser talks only to the Kana Next.js server,
and one server-held connection reaches the unmodified `hermes serve`; every
other integration (local voice engine, external voice services, Live2D assets)
is reached through a same-origin Kana route.

**Read when:** you need to know where a behaviour lives, which process owns it,
or which route carries a flow before changing code.
**Truth in code:** `proxy.ts`, `lib/server/hermes-bridge.ts`,
`lib/server/local-hermes-runtime.ts`, `lib/services/kana-workspace.ts`,
`lib/agent/types.ts`, `app/api/hermes/rpc/route.ts`, `lib/guardrails/`

## Process boundary

```text
browser
  -> Kana Next.js server (same origin, kana_session cookie)
  -> hermes-bridge: ONE server-held WebSocket to `hermes serve`
  -> Hermes agent loop, tools, filesystem, MCP, subagents, memory, context

browser
  -> /api/voice/tts/* -> irodori-c child process (one per utterance) or Pollinations
  -> https://cubism.live2d.com/sdk-web/cubismcore/*.js and a hosted .model3.json
```

A browser cannot spawn a process, so the Kana server owns the gateway
lifecycle (`lib/server/local-hermes-runtime.ts`). On first connect the bridge
adopts an already running `hermes serve` (process scan plus
`/proc/<pid>/environ` token read on Linux) or spawns the user's own binary with
a token Kana mints. The token stays in server process memory and is never
serialized into an API response, storage, or backup. Kana never patches,
vendors, or writes into the Hermes installation or source checkout.

`proxy.ts` runs before every request: it rejects a foreign host in local mode
(421, DNS-rebinding guard), rejects cross-site state-changing requests (403),
leaves `/api/auth/login`, `/api/auth/logout`, and `/api/auth/status` public,
and requires a valid session cookie for every other route and page.
`withSession` (`lib/server/api-response.ts`) re-checks the session inside each
route as defence in depth.

## Who owns what

Hermes owns reasoning and every agent capability: the model, tools, shell,
filesystem, MCP, subagents, memory, compaction, slash commands, approvals,
and the conversation transcript. Kana restores that transcript from Hermes
(`session.resume` -> the `history.restored` event); it does not keep an
authoritative copy.

Kana owns presentation and everything that renders it: the workspace UI,
local UI preferences, the per-turn tool-activity log (server-side SQLite),
avatar control, audio playback and lip sync, the persona/response contract,
and translating Hermes gateway events into the stable `AgentEvent` model.

Kana must never become a second agent. There is no second LLM loop, no
translation request, no tool runner, no conversation-store provider, and no
mock agent mode.

## Request and flow map

| Route | What flows through it |
| --- | --- |
| `GET /api/hermes/events` (SSE) | Every gateway event frame the bridge receives, with `MEDIA:` paths rewritten to signed links. Ends when the shared socket drops, so each tab reconnects and resumes. |
| `POST /api/hermes/rpc` | One allow-listed JSON-RPC request forwarded over the shared socket; the response returns correlated. `config.set` accepts only a session-scoped `model` value, the owner's prompt guardrail may refuse a turn here before it reaches the bridge, and the owner's rules are placed in Kana's note on every `prompt.submit`. |
| `POST /api/hermes/attachments` | One base64 chat attachment, validated then forwarded as Hermes `file.attach`; this method is not on the RPC allow-list. |
| `GET /api/kana/sessions` | `session.list` filtered server-side to `source: "kana"`, i.e. Kana's cross-browser conversation directory. |
| `GET`/`PUT /api/kana/activities` | The per-turn activity snapshots read from and written to `activities.db`. |
| `GET`/`PUT /api/kana/setup` | Install-level onboarding completion in `appstate.db`, shared by every browser of this user. |
| `GET /api/kana/config` | The `config.json` path, whether it exists, the deployment mode, and the prompt guardrail's state and rule count; never the file's contents, the key, or a rule's text. |
| `GET`/`POST`/`DELETE /api/kana/voices` | The voice library: reference WAVs on disk plus rows in `appstate.db`. |
| `POST /api/kana/voices/preview` | The sample for one voice: the bundled or user-uploaded reference WAV itself, or a prepared generation for the model voice. It never starts the engine. |
| `GET`/`HEAD /api/media/<token>/<name>` | One delivered file, streamed with byte ranges and ETag revalidation; the token is the only input that picks the file. |
| `GET`/`POST /api/local-runtime/hermes` | Inspect, `start`, `restart`, or `stop` the `hermes serve` Kana manages. A browser chooses only the action and optional port. |
| `GET /api/voice/tts/provider` | Safe provider metadata and health; credentials and upstream URLs stay server-side. |
| `POST /api/voice/tts/speech` | Synthesis: JSON in, raw audio bytes out, cancellable while bytes are still being delivered. |
| `POST /api/voice/tts/requests/[requestId]/cancel` | Cancels the active synthesis and releases the local engine process. |
| `GET`/`POST /api/voice/tts/engine` | Local Irodori engine/model install status and `install`, `cancel`, `remove` actions. |
| `GET /api/update` | Running version plus the install command when npm has a newer release; Kana never runs npm itself. |
| `POST /api/update/stop` | SIGTERM to this Kana server after confirmation, so the user can install an update. |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/status`, `POST /api/auth/password` | Password login, server-side logout revocation, public bootstrap status, and an authenticated password change. |

## Module map

Pages and composition:

- `app/page.tsx` mounts `components/kana/kana-app.tsx`, which creates one
  workspace per mount through `KanaWorkspaceProvider` and composes the stage,
  header, chat dock, sessions modal, connection gate, and dialogs. It also
  renders the always-light "Preparing Kana" screen until the workspace is ready.
- `app/layout.tsx` sets the document shell; `app/login/page.tsx` and
  `app/docs/page.tsx` are the login screen and the config guide.
- `components/kana/kana-workspace-context.tsx` owns the per-mount provider and
  the `useKanaWorkspace` / `useKanaStore` hooks.

State and services:

- `lib/store/` holds the per-concern zustand vanilla stores (`kana-stores.ts`
  builds one set per mount). `lib/services/kana-workspace.ts` constructs the
  stores and services and exposes the stable `actions` object the components
  call. Each service owns one concern: `hermes-session-manager.ts` (client
  lifecycle and session switches), `agent-event-handlers.ts` (`AgentEvent` to
  store updates), `conversation-service.ts` (working set, pointer, transcript
  restore), `send-message.ts` (prompt, Kana command, and slash submission),
  `command-service.ts`, `model-catalog-service.ts`, `voice-service.ts`,
  `avatar-service.ts`, `preferences-service.ts`, and `workspace-setup.ts`
  (first-run wizard, connection gate, auto-connect).
- `lib/runtime/` holds the small browser clients for Kana's own routes
  (`setup-client.ts`, `hermes-control-client.ts`, `auth-client.ts`,
  `update-client.ts`, `voice-*`).

Agent contract:

- `lib/agent/types.ts` is the stable boundary: `AgentClient`, `AgentEvent`,
  `AgentHistoryRow`, `AgentInputRequest`/`Response`, `ActivityItem`, model and
  session types. Components and services depend on these, never on Hermes
  wire shapes.
- `lib/agent/hermes/` is the only place that knows Hermes JSON-RPC:
  `hermes-agent-client.ts` (EventSource on `/api/hermes/events`, fetch to
  `/api/hermes/rpc`, event translation), `gateway-types.ts` (wire types), and
  `kana-command-surface.ts` (honest availability for platform-only commands).
  `lib/agent/pending-input-cache.ts` remembers approval/clarification/sudo/
  secret request metadata so a dialog survives a refresh.

Server:

- `lib/server/hermes-bridge.ts` (one shared socket, request correlation,
  connection-lost fan-out), `lib/server/hermes-event-stream.ts` (the SSE
  stream, heartbeat and slow-reader limit), `lib/server/local-hermes-runtime.ts`
  (spawn, discovery, restart, token custody),
  `lib/server/data-dir.ts`, `lib/server/app-state-store.ts`,
  `lib/server/activity-store.ts`, `lib/server/media-links.ts`,
  `lib/server/media-response.ts`, `lib/server/user-config.ts`,
  `lib/server/auth/`, `lib/server/irodori/`, and `lib/server/tts-provider/`.

Guardrail:

- `lib/guardrails/` owns the optional screen on the text Kana forwards to
  Hermes: `policy.ts` reads and validates the owner-written `guardrails` block
  of `config.json` (which Kana never writes), `prompt.ts` turns the owner's rules
  into the one question Kana asks, `jev.ts` is the TypeSafe System One adapter,
  `screen.ts` turns the answer into one allow-or-refuse outcome, and
  `protocol.ts` is the browser-safe half — the refusal codes and
  `PromptGuardrailError`. The relay route calls `screenPrompt`, and the relay
  client and `lib/services/send-message.ts` turn a refusal into Kana's fixed
  wording. The same route calls `loadGuardrailRules()` and `withKanaRules()`
  (`lib/presentation/persona.ts`) to place the rules inside the prompt note on
  every prompt turn; that path is a prevention layer and never decides a turn.

Presentation, avatar, voice:

- `lib/presentation/` owns the persona and response contract
  (`persona.ts`), its parser (`response-parser.ts`), the safe Markdown reader
  (`markdown.ts`), delivered-file links (`media.ts`), the spoken-reply queue,
  and the `/docs` JSON colouring.
- `lib/avatar/` owns the provider-independent controller, the
  Live2D/Pixi runtime adapter, the managed provider and its honest fallback,
  defaults, per-model bindings and layout, IndexedDB model persistence, and
  the portrait archive.
- `lib/voice/` owns the relay TTS client, audio lip sync, speech chunking, and
  the relay contract. `lib/preferences/` owns preference types and the
  localStorage store. `lib/backup/` owns the credential-free backup format.
  `lib/diagnostics/` owns redaction, including the short snapshot the fatal
  error pages copy.

## Seam rules

- Components depend on `AgentClient` and `AgentEvent`. Hermes JSON-RPC methods,
  params, and wire field names stay inside `lib/agent/hermes/`.
- Voice, avatar, conversation storage, presentation, and agent remain behind
  their own interfaces. Do not merge them into one component or controller.
- A new browser-called Hermes method must be added to the allow-list in
  `app/api/hermes/rpc/route.ts` (or it fails as "Unsupported Hermes method"),
  and a new persistent store must resolve through `lib/server/data-dir.ts`.
- Live chat and restored history must render the same way: the same
  `AgentEvent` types and the same stored messages feed `LiveChatFeed`, so a
  refresh produces the transcript the user already saw.
- The prompt guardrail reads the text of a turn at the relay and answers allow
  or refuse. It must not grow a second agent, a fallback model, or a way for the
  browser to set its rules: the rules and the key live in `config.json`, which
  Kana has no writer for. The same rules also ride in the prompt note as
  instructions, which is a prevention layer; it never replaces the screen or
  decides a turn.

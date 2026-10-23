# Hermes contract

Kana is a presentation layer in front of the user's existing Hermes Agent installation. This document is the surface of Hermes that Kana is allowed to call and the behavior an agent must respect when changing it.

**Read when:** you are touching the agent adapter, the server relay, slash handling, session lifecycle, or anything that reaches Hermes.
**Truth in code:** `app/api/hermes/rpc/route.ts`, `app/api/hermes/events/route.ts`, `lib/agent/types.ts`, `lib/agent/hermes/hermes-agent-client.ts`, `lib/agent/hermes/gateway-types.ts`, `lib/server/hermes-bridge.ts`, `lib/server/local-hermes-runtime.ts`, `lib/services/send-message.ts`, `lib/guardrails/`

## Integration boundary

`hermes serve` is Hermes's official JSON-RPC/WebSocket backend for desktop and remote UI clients. It is Kana's only integration surface; Kana does not impersonate a messaging platform, does not use Hermes's optional OpenAI-compatible API, and never patches, forks, vendors, or writes into the Hermes installation or its checkout.

A browser cannot spawn the Hermes binary, so Kana's Next.js server owns the gateway lifecycle (`lib/server/local-hermes-runtime.ts`). On first connect the server either adopts a running `hermes serve` (process scan plus `/proc/<pid>/environ` token read) or spawns the unmodified binary with a token it minted itself. That token lives in server process memory only: the browser reaches Hermes through `/api/hermes/*` with its Kana session cookie, and `hermes serve` inherits no `KANA_*` setting (`hermesServeEnvironment`).

`lib/server/hermes-bridge.ts` holds one upstream WebSocket and fans events out over SSE; `POST /api/hermes/rpc` forwards one JSON-RPC request over that shared socket. Request ids are namespaced per caller (`kana-relay-<n>`), pending calls are rejected when the socket drops, and frames larger than 8 MiB are ignored.

Hermes gates most RPCs to one active session per connection. Kana is a single-user surface, so one shared connection matches the product model.

### Relay routes

| Route | Owns |
| --- | --- |
| `GET /api/hermes/events` | SSE downstream of the shared socket |
| `POST /api/hermes/rpc` | Allow-listed JSON-RPC forward |
| `POST /api/hermes/attachments` | Prompt attachments (`file.attach`) |
| `GET /api/kana/sessions` | `session.list` filtered to `source: "kana"` |
| `GET/PUT /api/kana/activities` | Per-turn tool activity SQLite store |
| `GET/HEAD /api/media/[token]/[name]` | Streams a file Hermes delivered |
| `GET/POST /api/local-runtime/hermes` | Inspect/start/restart/stop the managed `hermes serve` |

Every route requires the Kana session cookie (`withSession`); none exposes the Hermes token.

## The JSON-RPC allow-list

Only the methods in `ALLOWED_METHODS` (`app/api/hermes/rpc/route.ts`) are forwarded; anything else fails with `Unsupported Hermes method.` (400). A method the browser calls must be added here, and to this document, or it does not work.

| Purpose | Methods |
| --- | --- |
| Session lifecycle | `session.create`, `session.resume`, `session.close`, `session.interrupt`, `session.title`, `session.branch` |
| Transcript and session state | `session.history`, `session.status`, `session.save`, `session.compress`, `session.steer` |
| Prompts and events | `prompt.submit` |
| Slash commands | `commands.catalog`, `complete.slash`, `slash.exec`, `command.dispatch` |
| Models and config | `model.options`, `config.set` |
| Approvals | `approval.respond` |
| Protected input | `clarify.respond`, `sudo.respond`, `secret.respond` |
| Message handoff | `handoff.request` |
| Gateway reloads | `reload.env`, `reload.mcp`, `skills.reload` |

`session.compress`, `model.options`, and `reload.mcp` use the long-running RPC timeout (`LONG_HERMES_RPC_TIMEOUT_MS` in `lib/limits.ts`). `config.set` is narrowed further: it accepts only a session-scoped model selection, requires `--provider` and `--session` in the value, and refuses `--global` and `--once`.

`session.list` is deliberately not on the browser allow-list. `GET /api/kana/sessions` calls it server-side and filters rows to `source === "kana"`, which is Kana's cross-browser session directory (`app/api/kana/sessions/route.ts`).

## Prompt guardrail

The owner may configure a prompt guardrail (`guardrails` in `config.json`, read by `lib/guardrails/policy.ts`). When it is on, `POST /api/hermes/rpc` screens the user's own text before forwarding, for `prompt.submit`, `session.steer`, `slash.exec`, and `command.dispatch`. The user's words come from `unwrapKanaUserPrompt`, so the Kana note and attachment references are never part of what a rule judges. An empty `apiKey` turns the screen off and no request is made.

Separately, the relay places the owner's rules in Kana's note on every `prompt.submit` (`withKanaRules`, populated by `loadGuardrailRules()`), after the screen has allowed the turn. This is a prevention layer, not enforcement: it runs with an empty `apiKey`, adds no request and no second model, and is read from `config.json` on each turn so a new rule applies to the next message. The rules sit inside `<kana>...</kana>`, after the user's words and before the note's close, so `unwrapKanaUserPrompt` still returns exactly what the user typed.

The screen is one request to TypeSafe's System One endpoint per turn (`lib/guardrails/jev.ts`), carrying one `noul` question built from the owner's rules by `lib/guardrails/prompt.ts`: the rules ride in the question's instructions, the message is the state, and Jev is told what the screening is for. The returned probability is compared against the owner's threshold in `lib/guardrails/screen.ts`. Jev returns no text and Kana asks for none. A probability at or above the threshold, or a guardrail that cannot run while `whenUnavailable` is `"block"`, returns HTTP 403 or 503 with `code: "prompt_guardrail_blocked"` or `"prompt_guardrail_unavailable"`, and the request never reaches `hermesRpc`. Adding a rule adds no request.

The relay client turns those codes into `PromptGuardrailError` (`lib/guardrails/protocol.ts`), and `lib/services/send-message.ts` answers it with Kana's own fixed wording instead of a send-failure banner. A refused command is not retried through `command.dispatch`, so one refusal costs one request. Hermes never saw the turn, so it holds no record of it; the user's message and Kana's line survive a reload as local rows. Answers to a Hermes prompt mid-turn (`approval.respond`, `clarify.respond`, `sudo.respond`, `secret.respond`) are deliberately not screened: refusing one would strand a turn Hermes already started.

## Session lifecycle

- Kana creates and resumes sessions with `source: "kana"` and `close_on_disconnect: false` (`openSessionOnce`). That source is what the directory filter matches.
- Hermes stores a session only once it accepts a prompt. Kana marks the conversation's link durable at that moment (`conversations.markStored` in `lib/services/send-message.ts`, `sessionStored` in the client), not when the reply lands, so a refresh during the first turn resumes the session instead of opening a blank one beside it.
- `session.resume` carries the full display transcript in `messages`; the adapter emits `history.restored` from it and does not make a second RPC.
- `session.history` accepts only the RUNTIME session id. A durable key returns "session not found", so `fetchHistory` takes no argument and is a fallback only after a session is open.
- A session Hermes never stored cannot be resumed after a restart. Kana stays connected, unlinks quietly, and opens a new session on the next prompt (`restore` in `hermes-agent-client.ts`, `onAgentError` in `agent-event-handlers.ts`). A stored session Hermes lost is reported instead of silently replaced.
- When the shared gateway socket drops, `resetSocket` rejects pending RPCs and every SSE stream ends (`onHermesConnectionLost` in `lib/server/hermes-bridge.ts`, consumed by `lib/server/hermes-event-stream.ts`). Tabs reconnect and resume; this prevents a stream that no longer delivers events.

## Prompt attachments

A message with files uploads each one through `POST /api/hermes/attachments` (`file.attach`) before submitting, and the returned reference (`@file:...`) is appended after the Kana note in the prompt. Hermes's context-reference parser reads references anywhere in the turn, and transcript restore drops them together with the note, so they never appear in a restored bubble (`sendMessage` in `hermes-agent-client.ts`, `unwrapKanaUserPrompt`).

## Busy input

A plain message typed while a turn is running is submitted with `prompt.submit` and no `queued` flag, so Hermes applies the user's own `display.busy_input_mode` (`_handle_busy_submit` in Hermes's `tui_gateway/server.py`). The default `interrupt` redirects the live turn: the in-flight model request is cancelled, completed tool work is kept, the correction joins the same turn, and the user receives one answer, as in the Hermes TUI. `steer` injects the text after the next tool call, and `queue` runs it as the next turn. `sendWhileBusy` reports which path Hermes took; `lib/services/send-message.ts` shows the matching status and does not emit a second `agent.started` for a redirect or steer, so the turn keeps one activity log. A turn Hermes starts from its own queue is announced with `message.start`, which becomes `agent.started` only when Kana has not already marked a turn running.

Kana keeps a received correction out of the transcript's bubble flow: `lib/conversation/live-feed-timeline.ts` attaches it to the user message that opened the turn, and the feed draws it as an icon line under that bubble with the same wording as the Hermes TUI, `Redirected current turn: '…'`. Hermes persists a redirect as a user row inside the running turn, so `parseHermesTranscript` recognises a user row after tool activity, or directly after another user row, as that correction; a steered message leaves no row, so `mergeRestoredMessages` restores its marker from the local copy on a same-browser reload. Each Kana conversation marks the messages with `correction` in `lib/conversation/types.ts`.

Command-generated prompts are different: Hermes's TUI queues slash commands while busy, so a `send`/`skill` prompt that arrives mid-turn stays in Kana's client-side queue and is submitted after the turn.

## Model selection

`config.set` sends `<model> --provider <slug> --session` unquoted. Hermes's `/model` parser splits on whitespace and never unquotes, so shell quoting would arrive as part of the provider name. A switch warning is passed through except Hermes's own `Note:` model-listing parts, which ride on switches Hermes accepted and read like failures (`switchWarning`).

## Reconnection

An unexpected stream drop rejects pending RPCs, marks a running turn for recovery, and schedules a reconnect (`DEFAULT_RECONNECT_DELAYS_MS`). After reconnecting, the client reopens the durable session, which restores its transcript and reports whether the turn is still running. `reconnectNow` skips the delay when Kana has just restarted `hermes serve`, and a second request joins the reconnect already under way instead of resuming twice. While the gate is up after a live drop, its Connect Hermes button uses `reconnectNow` instead of waiting for the next scheduled attempt, and starts a stopped `hermes serve` that Kana manages, so a dead process never leaves the button disabled behind its own retry loop. Clarification prompts arrive in two wire shapes — the legacy flat `{request_id, question, choices}` and the batch `{request_id, questions: [...]}` with per-question locks — and a reconnect replay can carry answers already locked (`clarifyRequest`).

## Events

`createHermesEventStream` sends the `gateway` status event and forwards each Hermes JSON-RPC `event` frame as an SSE `hermes` event. `hermes-agent-client.ts` translates them into the stable `AgentEvent` union (`lib/agent/types.ts`):

| Hermes event | AgentEvent |
| --- | --- |
| `gateway.ready` / `gateway` SSE | resolves the connection; `connection.changed` |
| `session.title` | `session.updated` |
| `message.start` | `agent.started` when Kana did not already mark a turn running |
| `message.delta` | `assistant.delta` (status only) |
| `message.complete` | `assistant.message` after `parseKanaResponse`, or `agent.error` |
| `tool.start`, `tool.progress`/`tool.generating`, `tool.complete` | `tool.started`, `tool.progress`, `tool.finished` |
| `status.update` | `status.updated` |
| `approval.request`, `clarify.request`, `sudo.request`, `secret.request` | `input.requested` |
| `sudo.expire`, `secret.expire`, `clarify.expire` | `input.expired` |
| `error` | `agent.error` |

`session.resume` also drives `history.restored` and, when the turn is still running, `agent.started` with `resumed: true` plus `status.updated`; its restored tools seed the live activity log instead of clearing it. `message.complete` with `status: "interrupted"` emits `agent.aborted`. Only the finished reply is shown for `message.delta`: streaming chunks update the status line, and the media relay blanks their text because a chunk can end halfway through a delivered path (`rewriteMediaInEvent` in `lib/server/media-links.ts`).

Events are ignored when they belong to another tab's session, unless this client is opening its own (`handleGatewayEvent`).

## Slash commands

- Typing `/` reads Hermes's live categorized registry with `commands.catalog`; a name or argument fragment uses `complete.slash`. Kana keeps no second command list and reimplements no fuzzy matching.
- Command names and arguments come from Hermes. Kana marks surface-only commands unavailable with an honest reason (`lib/agent/hermes/kana-command-surface.ts`), but never invents platform context.
- The nearest-command rule lives in `resolveTypedCommand` (`lib/services/send-message.ts`). A name that is itself one of the suggestions is never rewritten, so a destructive confirmation always names the command that runs. An unknown name uses the nearest suggestion, shortest first (`/qui` becomes `/quit`). Only the name token is substituted; a completion's argument fallback is never pasted over the command. No suggestion means the text goes to Hermes as typed.
- Commands run through `slash.exec`, falling back to `command.dispatch` — except after a guardrail refusal, where the fallback would screen the same words again. The structured result is honored: `exec`/`plugin` output, `alias` (re-executed, depth-capped), `prefill` (returns a draft), and `send`/`skill`, which are submitted to the same Hermes session with the Kana response contract and never trigger a second model. A `send`/`skill` prompt that arrives mid-turn is queued for the next turn.
- Dedicated RPCs replace terminal-text parsing: `/approve` and `/deny` use `approval.respond`; `/title` uses `session.title`; `/branch` uses `session.branch`; `/save`, `/status`, `/compress`, `/steer`, `/handoff` use `session.save`, `session.status`, `session.compress`, `session.steer`, `handoff.request`.
- `/reload`, `/reload-mcp`, and `/reload-skills` use `reload.env`, `reload.mcp`, and `skills.reload`, as Hermes's TUI does. Through `slash.exec` they would act on Hermes's separate slash worker instead of the `hermes serve` Kana talks to. `/reload-mcp` asks first (`confirm_required`); `now`, `approve`, `once`, `yes`, or `always` confirms.
- `/restart` is Kana's own command, not Hermes's gateway restart. It restarts only the `hermes serve` Kana started, on the same port with a new token (`restartLocalHermesRuntime`, `POST /api/local-runtime/hermes` `{"action":"restart"}`), then resumes the open conversation. An adopted or externally started server is left alone, and discovery is off during the restart so another Hermes is never adopted.

## When a Hermes change becomes visible

Models and providers added to `config.yaml` appear in `model.options` at once, because Hermes rereads the file when its mtime changes; an already-open session keeps its model until switched. `~/.hermes/.env` is read at startup, so it needs `/reload`. Anything else Hermes reads only at startup needs `/restart`. Hermes must never stop or restart `hermes serve` itself: the Kana conversation runs on that process.

## Delivered files

Hermes delivers a file by writing `MEDIA:/local/path` on its own line in a reply (the same convention its messaging gateways use). Before any payload reaches the browser, Kana rewrites every deliverable path to a signed `MEDIA:/api/media/<token>/<name>` link (`rewriteMediaInResult` for RPC results and restored transcripts, `rewriteMediaInEvent` for live events). User rows are left untouched, and the browser never receives the path.

A deliverable is an existing regular file with symlinks resolved, outside system paths, home credential files and folders, Hermes's secret files, and Kana's own data root; the route rechecks the file on every request (`lib/server/media-links.ts`, `app/api/media/[token]/[name]`). A path that is not deliverable, and any `MEDIA:` tag inside code, stays as text. The token is the resolved path, encrypted and authenticated with a key derived from the installation secret, so the same file always maps to the same link and stored links survive a restart.
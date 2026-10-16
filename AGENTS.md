<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Kana project guide

Kana is a local web UI and presentation/persona layer for the user's existing
Hermes Agent installation. Hermes is the only AI agent. Kana must never become a
second agent, proxy LLM, translation LLM, or replacement agent loop.

The ownership boundary is:

```text
User
  -> Kana Web UI (browser)
  -> Kana server relay (/api/hermes/*, same-origin session cookie)
  -> HermesAgentClient over the relay (SSE events + allow-listed JSON-RPC)
  -> hermes-bridge: ONE server-held WebSocket to unmodified `hermes serve`
  -> Hermes agent loop, tools, filesystem, MCP, subagents, memory, and context
```

Kana owns presentation, local UI preferences, the per-turn tool-activity log
(server-side SQLite), avatar control, audio playback, and translating Hermes
events into a stable internal UI model. The conversation transcript itself is
owned by Hermes and restored from it. Hermes owns reasoning and every agent
capability.

## The code is the truth, `docs/` is the outline

`docs/` carries the big picture, the rules that are easy to break, and the
procedures that must run in order. It is written for agents, and it is never the
truth about behaviour: the code is. When a document and the code disagree, the
code wins, and the document you proved wrong is stale — correct it in the same
change that touches the behaviour it describes.

Start at `docs/README.md`, which is the map. Every document opens with a
**Read when:** line and a **Truth in code:** list naming the files that actually
decide the behaviour; open those files before you rely on a sentence.

| You are changing | Read |
| --- | --- |
| Where a behaviour lives, which process owns it, a route or a module | `docs/agent/architecture.md` |
| Anything that reaches Hermes: adapter, relay, events, slash commands, session lifecycle | `docs/agent/hermes-contract.md` |
| The persona prompt, the response parser, speech, subtitle, emotion, restored history | `docs/agent/response-contract.md` |
| State, a cache, a preference, a persisted file, a route that reads one | `docs/agent/state-and-storage.md` |
| What a check proves, or a hand-off and release decision | `docs/agent/quality-gates.md` |
| A component, `app/globals.css`, Settings, the avatar wardrobe, chat, or the composer | `docs/agent/ui-direction.md` |
| Installing, configuring, deploying, or securing an installation | `docs/operator/`: `install.md`, `configure.md`, `composer.md`, `security.md`, `supported-environment.md`, `compatibility.md` |
| Why an expensive-to-reverse decision was taken | `docs/decisions/` |
| Releasing, or a claim that needs real-world evidence | `docs/evidence/` |

Rules for the documents themselves: English, formal and plain; `# Sentence-case
title` and `## Sentence-case headings`; the mandatory `**Read when:**` and
`**Truth in code:**` header; prose over lists; lowercase-kebab file names; no
emoji. Every path, class, token, and command a document cites must exist now, so
verify it in the checkout, and never document a command that `package.json` does
not define. Do not add a dated or single-audit document: when a finding changes a
rule, change the rule where it lives.

## Non-negotiable rules

- Do not modify, patch, fork, vendor, or write into the user's Hermes
  installation or source checkout.
- Do not implement an LLM loop, tool runner, shell runner, filesystem agent,
  MCP client/server, subagent system, memory system, compaction system, or
  context manager in Kana.
- Do not create a separate Kana model for persona or translation. Persona and
  subtitle generation belong in the same Hermes response.
- Keep Hermes-specific JSON-RPC details inside `HermesAgentClient` and its
  gateway types. Components should depend on `AgentClient` and `AgentEvent`.
- Keep voice, avatar, conversation storage, presentation protocol, and agent
  concerns behind their existing interfaces. Do not merge them into one React
  component or controller class.
- Shared workspace state lives in the zustand stores under `lib/store/`,
  created per mount by `createKanaStores()`; side effects live in the
  services under `lib/services/`. Never create a module-level store or cache.
  State used by a single component stays local `useState`.
- The browser never holds a Hermes session token. The Kana server mints or
  discovers it, keeps it in process memory, and the browser reaches Hermes
  only through `/api/hermes/*`.
- All server-side persistent state (auth hash, JWT secret, activities DB)
  lives under ONE data root resolved by `lib/server/data-dir.ts`
  (`KANA_DATA_DIR` → `~/.kana`; an earlier root is moved there on first run).
  Never introduce a new `$CWD`-relative storage location.
- Do not hardcode a single Live2D model or third-party copyrighted character.
- Do not hardcode a subtitle language or reintroduce a subtitle language
  setting: Hermes subtitles in the language the user writes in.
- Do not retranslate old conversation history when the user switches
  language.
- Do not add a dependency until the existing project and browser APIs have been
  checked for an equivalent capability.
- Kana has no second mock agent or conversation-store provider; agent and
  avatar modes remain Hermes and Live2D. TTS is selected server-side between
  the local irodori-c engine and explicitly configured external voice
  services, and integrations must fail honestly when their service is
  unavailable. Each external service is its own adapter shaped after that
  service's documented API (Pollinations today); never reintroduce a generic
  "OpenAI-compatible" adapter, because speech APIs have no common standard.
- Never download the local voice engine or model without an explicit user
  request (Settings → Voice). Every artifact stays pinned by size and SHA-256
  in `shared/irodori-release.mjs` and is verified before use; do not vendor
  engine binaries or model weights into the repository or packages.

## Custody, relay, and storage

`docs/agent/architecture.md` and `docs/agent/state-and-storage.md` carry the
detail. The invariants:

- The browser authenticates with its Kana session cookie; the Hermes session
  token stays inside the server process (`lib/server/hermes-bridge.ts`).
- Each SSE stream ends when the shared gateway socket closes, so every tab
  reconnects and resumes after a Hermes restart instead of keeping a stream that
  no longer delivers events. Hermes stores a session only once it accepts a
  prompt; a session it never stored cannot be resumed after a restart, and the
  client opens a new one on the next message rather than reporting it lost.
- Transcript authority is Hermes. Restoring a conversation parses what
  `session.resume` returns and emits it as `history.restored`; `session.history`
  accepts only the RUNTIME session id and is a fallback only.
- Per-turn activity logs are Kana's own and live in `activities.db`, keyed by
  the durable Hermes session plus a zero-based assistant-reply ordinal.
- Files Hermes delivers with `MEDIA:/local/path` reach the browser as signed
  links, never as paths: the relay rewrites them, the token is the encrypted and
  authenticated path, and `GET /api/media/<token>/<name>` re-checks the file on
  every request. Never add a route that accepts a path from the browser.
- Login is password-based behind a deny-by-default proxy, and there is NO
  default password. Never add a web flow that sets the first password; the
  server shows the one command for this install and the owner runs it. Login
  lockout is per signed device cookie plus one shared bucket for unknown
  clients, never per IP.
- The proxy rejects cross-site state-changing requests and, in local mode,
  answers only the loopback names plus `KANA_TRUSTED_ORIGINS`.
- Request-size limits live only in `lib/limits.ts`, and route handlers read
  bounded bodies through `lib/server/request-body.ts`.

## Response and language contract

Hermes must return one structured user-facing response per normal assistant turn
(response protocol 3): a header between `---` lines, then the answer as Markdown.

```
---
ja: <the same reply as natural spoken Japanese, on one line>
emotion: <neutral | happy | sad | angry | surprised | thinking | confused | excited>
lang: <BCP 47 code of the answer below>
---
<the answer shown on screen; Markdown allowed>
```

While Kana's voice is off (the `voiceEnabled` preference) the header has no `ja`
line: nothing would read it, so the model does not spend tokens on it, and the
parser reads such a reply as `speech_ja: ""`.

- The contract rides in the user turn, after the user's words, inside a
  `<kana>...</kana>` note. The first prompt after a session opens, new or
  resumed, carries the full contract; later prompts carry a short skeleton. Do
  not send it as a system-role seed on `session.create`: some routes drop a
  second system message before the model sees it, and Hermes never stores it.
- The note follows the voice: with voice on, Kana reads `ja` aloud, so Hermes
  must never call a TTS tool to speak and makes an audio file only when asked
  for a file. With voice off, there is no `ja` line and a user who wants to hear
  Kana is pointed to Settings → Voice.
- Transcript restore strips the note, so its shape must stay stable.
- `ja` is always natural conversational Japanese: plain speech, no Markdown,
  emoji, URLs, or code.
- The answer is in the language of the user's latest message; when that message
  has no clear language (a command, a name, code), the language of the user's
  earlier messages. `lang` is the language actually used. Kana sends no
  subtitle language and has no such setting, and writing in another language
  affects future replies only.
- The voice only ever reads Japanese. A `ja` value without Japanese script, or a
  plain reply that is not mostly Japanese, becomes `speech_ja: ""` and the reply
  is shown at once without a voice. Never speak the answer text as a fallback
  and never make a second translation request.
- Every stored assistant message preserves the exact `speech_ja`, subtitle text,
  subtitle language, emotion, and timestamp that were displayed; rendering
  history uses the stored subtitle and never derives or retranslates it.

`docs/agent/response-contract.md` has the parser's tolerances and the delivery
detail.

## Slash commands

- Typing `/` reads Hermes's live categorized `commands.catalog`; command
  fragments and arguments use `complete.slash`. Never reimplement fuzzy
  matching and never keep a second command list.
- `resolveTypedCommand` only decides when to use the suggestion Kana already
  has: a name that is itself one of the suggestions is never rewritten, so a
  destructive confirmation always names the command that runs; an unknown name
  takes the nearest suggestion's name, shortest first, keeping typed arguments;
  no suggestion goes to Hermes as typed; only the name is substituted, never a
  completion's argument fallback. The rewritten command is what the transcript
  shows.
- Commands execute through `slash.exec`, falling back to `command.dispatch`
  where Hermes requires it. Quick commands, aliases, plugins, bundles, and
  skills must honor the structured result Hermes returns (`output`, `alias`,
  `send`, `prefill`, `skill`), and `send`/`skill` are submitted to the same
  Hermes session without triggering a second model.
- `/approve` and `/deny` use `approval.respond`; `/title` and `/branch` use
  their dedicated session RPCs; `/save`, `/status`, `/compress`, `/steer`, and
  `/handoff` use dedicated Hermes RPCs rather than parsing terminal text.
- `/reload`, `/reload-mcp`, and `/reload-skills` use `reload.env`, `reload.mcp`,
  and `skills.reload`, as the Hermes TUI does: through `slash.exec` they would
  run in Hermes's slash worker, a separate process, and never reach the
  `hermes serve` Kana talks to.
- `/restart` is Kana's own command, because Hermes's `/restart` restarts the
  messaging gateway. It restarts the `hermes serve` Kana started, on the same
  port with a new token, then resumes the open conversation; it leaves a Hermes
  Kana adopted or did not start alone, and waits for a reply to finish.
- Every method the browser calls must be on the relay allow-list
  (`app/api/hermes/rpc/route.ts`), or it fails as "Unsupported Hermes method."
- Command prompts returned while Hermes is already running are queued for the
  next turn rather than submitted concurrently.
- Telegram replaces hyphens with underscores because of its own command-name
  restrictions; Kana accepts those spellings and normalizes to Hermes's
  canonical hyphenated names.
- Platform-only commands get an explicit Kana equivalent or an honest
  unavailable state. Never invent fake Telegram or Discord context, and never
  copy a platform's visible command menu into a static array.
- `/new`, `/sessions`, and `/resume` are Kana's own conversation actions, and
  each Kana conversation keeps its linked durable Hermes session.

`docs/agent/hermes-contract.md` holds the allow-list and the session-lifecycle
detail.

## Hermes environment and safety

The user-owned executable is:

```text
~/.local/bin/hermes
```

The source currently available for read-only inspection is:

```text
~/.hermes/hermes-agent
```

Official upstream:

```text
https://github.com/NousResearch/hermes-agent
```

Read Hermes source when behavior can be verified there. Never assume a protocol
that Hermes already defines, and never edit either location above.

`docs/agent/hermes-contract.md` records the interfaces confirmed in the installed
source. Treat any count or list read from Hermes as an observation, not a
constant: Kana keeps reading the live registry.

## Releases

`docs/evidence/release-checklist.md` is the procedure. Two rules it depends on:

- npm publishing uses the owner's interactive 2FA. A page that offers **Use
  security key** is a valid WebAuthn/passkey challenge; it does not mean that 2FA
  was skipped merely because npm did not request a six-digit TOTP code. TOTP and
  WebAuthn are alternative second-factor methods, and the owner must complete
  whichever challenge npm presents. Never guess, request from an untrusted
  source, or enter an OTP/passkey response on the owner's behalf. Codex and
  other non-GUI shells may not have a working `xdg-open`, so use npm's supported
  manual-URL mode instead of pressing Enter at a browser-opening prompt:

  ```bash
  npm publish ./cli --ignore-scripts --auth-type=web --browser=false
  ```

  Open the printed `https://www.npmjs.com/auth/cli/...` URL in a browser already
  signed in as the package owner, then leave the final WebAuthn/TOTP interaction
  to the owner. Keep the publish process running while authorization completes,
  and require both the successful `+ kana-alya@<version>` output and registry
  verification of `version` and `dist-tags.latest` before updating GitHub release
  notes. For unattended releases, prefer npm Trusted Publishing from the
  repository's GitHub Actions workflow; do not weaken or disable 2FA and do not
  introduce a bypass-2FA token.
- A release build can never run from this checkout. Next.js records the absolute
  build folder in the runtime files, so a build under the maintainer's home
  directory would publish their account name with the package. Clone the
  committed revision to a fresh path outside the home directory whose path names
  no account and run the release there. `scripts/prepare-npm-package.mjs`
  enforces this with `--build`, which `cli/package.json`'s `prepack` passes, so
  `npm run publish:cli`, `npm publish ./cli`, and a plain `npm pack ./cli` fail
  from here; the paths that pass `--ignore-scripts` only warn. Treat the warning
  as the same rule.

## Distribution

- Root `package.json` is the private source app `kana-app`; `cli/package.json`
  is the public `kana-alya` package. Keep the versions equal, generate CLI
  payloads through `npm run package:npm`, and publish only through the guarded
  CLI path.
- `bin/` and `config/` are the authoritative sources, not the generated `cli/`
  copies.
- `kana` opens a local browser; `kana serve` is the foreground, headless
  deployment command. Both use the same config and server implementation.
- Deployment requires one server process per data root. Process-held gateway and
  cancellation state means multiple clustered workers sharing one data root are
  not supported.
- TTS uses one `tts.provider` selector. Inactive provider settings do not
  influence active requests, and cancellation follows the original request
  owner. Spoken replies wait in `lib/presentation/spoken-reply-queue.ts` until
  audio starts; Stop and failure reveal the text, and a failure must stay
  visible in the UI.
- The local voice engine and model are pinned artifacts installed on request.
  Never patch Hermes or an engine release to change behavior.

## Known open work

- Streaming TTS only if the local engine can provide a stable, cancellable
  stream and the latency improvement justifies the complexity.
- A signed desktop wrapper only if users need process supervision, OS keychain
  integration, or native auto-start. Hermes stays external and independently
  updatable.
- Automated cross-browser end-to-end tests once a stable CI browser target is
  chosen; today's responsive and accessibility checks are local.
- Active-turn and protected-input Hermes restart cases are an explicit
  acceptance matrix with local evidence
  (`docs/evidence/hermes-restart.md`), not an automated pass.

## Development workflow

Before coding:

1. Read this file completely.
2. Read the relevant installed Next.js guide under
   `node_modules/next/dist/docs/`.
3. Read the document for the area you are changing, then the code it names.
4. Inspect Hermes source when changing integration behavior.
5. Preserve unrelated user changes in the working tree.

Run the app in development:

```bash
npm install
npm run dev -- --hostname 127.0.0.1
```

Before handing off an implementation, run:

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run package:local
```

`npm run quality` runs the whole gate in order and stops at the first failure;
`docs/agent/quality-gates.md` lists every step and what it proves. The gates that
need a real environment are separate:

```bash
npm run test:hermes:restart
npm run test:live2d:official
npm run hermes:active-check
npm run dogfood:check
```

The Live2D command needs internet access to Live2D and GitHub's pinned official
assets. Local voice checks need target hardware, and dogfood intentionally fails
until seven real days and every required matrix case have evidence.

For Hermes changes, also test against a temporary `hermes serve` instance on a
non-default port. Use a unique `source: "kana"` test session, close it, and
remove only test data created by that check. Never delete or alter existing user
sessions.

## Definition of done

A change is done only when:

- Hermes remains unmodified and independently updatable;
- no second agent or redundant LLM request was introduced;
- interfaces still isolate Hermes, voice, avatar, storage, and presentation;
- Japanese speech and selected-language subtitle rules still hold;
- stored historical subtitles remain byte-for-byte what the user saw;
- the browser holds no Hermes token and no new `$CWD`-relative server state
  path was introduced;
- real integrations fail honestly when their external service is unavailable;
- lint, TypeScript, and production build pass in proportion to the change;
- the documents this change proved wrong were corrected in the same change.
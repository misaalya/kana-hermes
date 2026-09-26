<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Kana Project Guide

This file is the implementation handoff and operating guide for agents working
on Kana. Read it completely before changing the project. The status below was
last reviewed on 2026-08-25. Active remediation work is tracked in `PLAN.md`.

## Product definition

Kana is a local web UI and presentation/persona layer for the user's existing
Hermes Agent installation. Hermes is the only AI agent. Kana must never become
a second agent, proxy LLM, translation LLM, or replacement agent loop.

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
  (`KANA_DATA_DIR` → XDG → HOME). Never introduce a new `$CWD`-relative
  storage location.
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

## npm release authentication

npm publishing for this project uses the owner's interactive 2FA. A page that
offers **Use security key** is a valid WebAuthn/passkey challenge; it does not
mean that 2FA was skipped merely because npm did not request a six-digit TOTP
code. TOTP and WebAuthn are alternative second-factor methods, and the owner
must complete whichever challenge npm presents. Never guess, request from an
untrusted source, or enter an OTP/passkey response on the owner's behalf.

Codex and other non-GUI shells may not have a working `xdg-open`. For an
interactive release from such an environment, use npm's supported manual-URL
mode rather than pressing Enter at a browser-opening prompt:

```bash
npm publish ./cli --ignore-scripts --auth-type=web --browser=false
```

Open the printed `https://www.npmjs.com/auth/cli/...` URL in a browser already
signed in as the package owner, then leave the final WebAuthn/TOTP interaction
to the owner. If the owner does not want browser automation, stop after
printing the URL and ask them to open it themselves. Keep the publish process
running while authorization completes, then require both the successful
`+ kana-alya@<version>` output and registry verification of `version` and
`dist-tags.latest` before updating GitHub release notes.

For unattended future releases, prefer npm Trusted Publishing from the
repository's GitHub Actions workflow. Do not weaken or disable 2FA and do not
introduce a bypass-2FA token merely to avoid the interactive browser step.

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

Read Hermes source when behavior can be verified there. Never assume a
protocol that Hermes already defines, and never edit either location above.

## Hermes integration decision

Hermes exposes multiple surfaces with different purposes:

- `hermes gateway` is the messaging gateway for Telegram, Discord, Slack, and
  similar platform adapters. Kana does not impersonate one of these platforms.
- `hermes serve` is the official JSON-RPC/WebSocket backend for desktop and
  remote UI clients. This is Kana's integration boundary.
- Hermes's optional OpenAI-compatible API is useful for generic chat clients,
  but it does not expose the full session, event, approval, and slash-command
  control plane Kana needs.

A local bridge is required because a browser cannot spawn the Hermes binary.
Kana's Node server owns the gateway lifecycle: on first connect it discovers a
running `hermes serve` (process-table scan plus `/proc/<pid>/environ` token
read, Linux) or spawns the unmodified binary itself with a server-minted
session token. The token never leaves the Kana server process. Manual starts
are still honored: `hermes serve --host 127.0.0.1 --port 9119` is discovered
and adopted when its environment exposes `HERMES_DASHBOARD_SESSION_TOKEN`.

## Server-side custody, relay, and the data root

```text
Browser                         Kana Next.js server                Hermes
SSE  GET /api/hermes/events  ->  hermes-bridge (1 shared WS)   ->  /api/ws
RPC  POST /api/hermes/rpc    ->  allow-listed JSON-RPC forward
     GET  /api/kana/sessions ->  session.list filtered to source "kana"
     GET/PUT /api/kana/activities -> SQLite activity store
     GET  /api/media/<token>/<name> -> a file Hermes delivered (MEDIA:)
```

- The browser authenticates with its Kana session cookie; the Hermes session
  token stays inside the server process (`lib/server/hermes-bridge.ts`).
- Each SSE stream ends when the shared gateway socket closes
  (`onHermesConnectionLost`), so every tab reconnects and resumes after a
  Hermes restart instead of keeping a stream that no longer delivers events.
  Hermes stores a session only once it accepts a prompt; a session it never
  stored cannot be resumed after a restart, and the client opens a new one
  on the next message rather than reporting it lost.
- Transcript authority is Hermes: restoring a conversation parses the
  `messages` returned by `session.resume` (emitted to the UI as the
  `history.restored` agent event). `session.history` accepts only the RUNTIME
  session id, never the durable key, and is a fallback only.
  Restored rows get synthetic timestamps and the chat is time-ordered, so
  `mergeRestoredMessages` re-times Kana's own rows (command notes such as
  `/restart`) to stay after the restored row they followed.
- Per-turn tool activity logs live in SQLite (`activities.db`) keyed by the
  durable Hermes session plus a zero-based assistant-reply ordinal
  (`turn_index`, schema v2). They are reconstructed from restored history and
  mirrored by live turns through `/api/kana/activities`.
- All persistent server state — auth hash, JWT secret, activities DB — lives
  under one data root resolved by `lib/server/data-dir.ts`
  (`KANA_DATA_DIR` → XDG → HOME; production fails loudly without it). Legacy
  files from `$HOME/.kana` / `$CWD/data` are adopted on first use.
- Login is password-based with a deny-by-default proxy. There is NO default
  password: logins are refused until the owner sets one on the server with
  `kana password` (the first `kana`/`kana serve` start prompts for it). Never
  add a web flow that sets the first password. Until one exists the login
  page shows the one command for this install in the /docs code block
  (`components/kana/code-block.tsx`) and switches to the form by itself. The
  launcher passes it as `KANA_PASSWORD_COMMAND` (`kana password` for the npm
  package, `node bin/kana.mjs password` for a standalone deployment); a
  server started without the launcher is a checkout, `npm run password`.
  `/api/auth/status` names it only while no password exists, and only one of
  those three (`lib/server/auth/password-command.ts`). The scrypt hash lives in the
  `auth.password` row of `appstate.db` (format shared with the launcher via
  `shared/app-state-db.mjs`); legacy bcrypt/`auth.json` hashes still verify and
  are upgraded. Every process-control route requires a session.
- The proxy rejects cross-site state-changing requests (Origin vs Host, see
  `lib/server/request-origin.ts`). Login lockout is per signed device cookie
  plus one shared bucket for unknown clients — never per IP.
- Route handlers use `withSession`/`jsonError` from `lib/server/api-response.ts`
  and bounded body readers; request-size limits live only in `lib/limits.ts`.
- Password changes atomically rotate the session version stored with the hash.
  Prior tokens are rejected, including a login that was still checking the old
  password. Existing SSE streams revalidate authorization every 25 seconds.
  Login admits one password check per limiter bucket at a time; passwords are
  8–256 characters without leading/trailing whitespace.
- Files Hermes delivers with `MEDIA:/local/path` (its gateway convention; the
  TTS, browser-screenshot, and MCP tools return one) reach the browser as
  signed links, never as paths (`lib/server/media-links.ts`):
  - the events and RPC routes rewrite every deliverable path to
    `MEDIA:/api/media/<token>/<name>` before relaying. User rows are left
    alone, and `message.delta` chunks lose their text (a chunk can split a
    path; Kana shows only the finished reply);
  - the token is the resolved path, encrypted and authenticated (AES-256-GCM,
    synthetic IV = HMAC of the path) with a key derived from the installation
    secret. The browser cannot name a path, the same file always gets the same
    link (live and restored replies compare equal, stored links survive a
    restart), and there is no table to store or expire;
  - "deliverable" mirrors Hermes's default rule (`validate_media_delivery_path`
    in gateway/platforms/base.py): an existing regular file with symlinks
    resolved, outside system paths, home credential folders (`~/.ssh`,
    `~/.config`, ...), Hermes's secret files (`.env`, `config.yaml`,
    `auth.json`, ...), and Kana's own data root. Any other path, and any tag
    inside code, stays as text. The route checks the file again on every
    request;
  - `GET`/`HEAD /api/media/<token>/<name>` streams the file with byte ranges
    (audio and video seek), ETag revalidation, and `private, no-cache`.
    Audio, video, and raster images are inline; everything else, and any
    request with `?download`, is an attachment. Responses carry a sandbox CSP
    (set in next.config.ts too, since the app policy would replace it) so an
    SVG or HTML file never runs as Kana;
  - `hermes serve`'s own `GET /api/media` is not used: it returns only cached
    images, as base64;
  - the chat shows delivered files under the reply (`MediaAttachments`):
    a player for audio and video, a preview for images, and a Download pill
    for every file. The history preview names the file instead.
- Local speech runs the irodori-c engine as one short-lived child process per
  utterance (serialized, minimal environment). The browser reaches it only
  through `/api/voice/tts/*` relay routes: `speech`, request cancellation, and
  `engine` (install status and install/cancel/remove actions).

For VPS deployment requirements see the checklist in `PLAN.md` §10 and
`docs/SUPPORTED_ENVIRONMENT.md`.

## Hermes interfaces confirmed in the installed source

The current adapter uses or is designed around these official methods:

- session lifecycle: `session.create`, `session.resume`, `session.close`,
  `session.interrupt`, `session.title`, and `session.branch`;
- transcript access: `session.history` (RUNTIME session id only — the durable
  key returns "session not found") and `session.list` (durable directory,
  filtered to `source: "kana"` server-side);
- prompts and events: `prompt.submit` plus gateway session/message/tool/status
  events;
- slash commands: `commands.catalog`, `complete.slash`, `slash.exec`, and
  `command.dispatch`;
- approvals: `approval.respond`;
- protected input: `clarify.respond`, `sudo.respond`, and `secret.respond`;
- dedicated controls: `session.save`, `session.status`, `session.compress`,
  `session.steer`, and `handoff.request`.

Live inspection of the installed Hermes version returned 165 catalog entries
and categorized command groups. `/reasoning ` also returned live argument
choices through `complete.slash`. Treat these numbers as observations, not
constants; Kana must keep reading the live registry.

The last isolated live audit used a temporary non-default server, created a
`source: "kana"` runtime session without sending an LLM prompt, verified status
and argument completion, closed it, and confirmed that no durable test session
remained. The temporary server was then stopped.

## Slash-command behavior

Kana should feel like another first-class Hermes client:

- Typing `/` reads the categorized `commands.catalog` response.
- Typing a command fragment or command arguments uses `complete.slash`.
- Commands execute through `slash.exec`, falling back to `command.dispatch`
  where required by Hermes.
- Quick commands, aliases, plugins, bundles, and skills must honor the
  structured result returned by Hermes (`output`, `alias`, `send`, `prefill`,
  or `skill`).
- `send` and `skill` results are submitted to the same Hermes session with the
  Kana response contract. They must not trigger a second model.
- `/approve` and `/deny` use `approval.respond`; `/title` and `/branch` use
  their dedicated session RPCs.
- `/save`, `/status`, `/compress`, `/steer`, and `/handoff` use dedicated
  Hermes RPCs rather than parsing terminal text.
- `/reload`, `/reload-mcp`, and `/reload-skills` use `reload.env`,
  `reload.mcp`, and `skills.reload`, as the Hermes TUI does. Through
  `slash.exec` they would run in Hermes's slash worker, a separate process,
  and never reach the `hermes serve` Kana talks to. `/reload-mcp` asks first
  (`confirm_required`); `/reload-mcp now` or `always` confirms. Every method
  the browser calls must be on the relay allow-list
  (`app/api/hermes/rpc/route.ts`), or it fails as "Unsupported Hermes method."
- `/restart` is Kana's own command. Hermes's `/restart` is `gateway_only`: it
  restarts the messaging gateway, not `hermes serve`. Kana's restarts the
  `hermes serve` Kana started, on the same port with a new token
  (`restartLocalHermesRuntime`, `POST /api/local-runtime/hermes`
  `{"action":"restart"}`), then resumes the open conversation. It leaves a
  Hermes Kana adopted or did not start alone, and waits for a reply to
  finish. Discovery is off while a restart runs, so Kana never adopts
  another Hermes on the briefly free port.
- What each Hermes change needs (verified with Hermes 0.20.1): models and
  providers added to `config.yaml` appear in `model.options` at once, because
  Hermes rereads the file when its mtime changes (an open session keeps its
  model until switched); `~/.hermes/.env` is read at startup, so `/reload`;
  anything else Hermes reads only at startup, `/restart`.
- `/new`, `/sessions`, and `/resume` are surface-aware Kana conversation
  actions. Each Kana conversation retains its linked durable Hermes session.
- Hermes writes a session's row when `prompt.submit` accepts the first
  prompt, so Kana marks the link durable right then (not when the reply
  lands): a refresh during the first turn resumes that session instead of
  opening a blank conversation beside it.
- `session.create` gets a title only when the user chose one (`/new <title>`).
  Hermes keeps a create-time title as the user's choice and reapplies it on
  `session.title`, which would overwrite the name Hermes gives the session;
  automatic titles (the default, or the first message) stay local.
- Model switches send `<model> --provider <slug> --session` unquoted, to
  `config.set` and in `/model` completions. Hermes splits `/model` arguments
  on whitespace and never unquotes, so `'custom:9router'` would be an unknown
  provider.
- Command prompts returned while Hermes is already running are queued for the
  next turn rather than submitted concurrently.
- Telegram replaces hyphens with underscores because of Telegram command-name
  restrictions. Kana accepts underscore spellings but internally normalizes to
  Hermes's canonical hyphenated names.
- Platform-only commands such as Telegram topic or messaging identity controls
  may not make sense in Kana. Add an explicit Kana equivalent or an honest
  unavailable state; do not invent fake Telegram/Discord context.

Do not copy Telegram's visible command menu into a static array. Telegram,
Discord, Slack, the Hermes TUI, and Kana all expose surface-specific views over
Hermes's central registry. New Hermes commands and installed skills should be
discoverable without changing Kana's source.

## Kana response and language contract

Hermes must return one structured user-facing response per normal assistant
turn (response protocol 3): a header between `---` lines, then the answer
as Markdown.

```
---
ja: <the same reply as natural spoken Japanese, on one line>
emotion: <neutral | happy | sad | angry | surprised | thinking | confused | excited>
lang: <BCP 47 code of the answer below>
---
<the answer shown on screen; Markdown allowed>
```

While Kana's voice is off (the `voiceEnabled` preference) the header has no
`ja` line: nothing would read it, so the model does not spend tokens on it.
The parser reads such a reply as `speech_ja: ""`.

`parseKanaResponse` turns it into:

```ts
type KanaResponse = {
  speech_ja: string; // "" when the reply had no Japanese speech
  subtitle: {
    text: string;
    language: string;
  };
  emotion?: Emotion;
};
```

The header costs fewer tokens than the protocol 1/2 JSON envelope because
the answer is not quoted or escaped. The parser still reads JSON envelopes
(restored history, models with the old habit) and tolerates a fenced reply,
a missing opening rule (only when the reply starts with `ja:`, or with
`emotion:` and a real emotion), quoted values, a wrapped `ja` line, and
unknown emotions (neutral).

Delivery (verified with `hermes serve` and 9router, 2026-09-26):

- The contract rides in the user turn, after the user's words, inside a
  `<kana>…</kana>` note (`buildKanaUserPrompt`). The first prompt after a
  session opens, new or resumed, carries the full contract; later prompts
  carry a short skeleton that is enough on its own. A failed submit keeps the
  full contract for the retry.
- The full contract tells Hermes what Kana is: an app with an avatar and its
  own voice on top of the session. The avatar, the chat screen, Kana's
  settings, and Kana's text-to-speech (Irodori or Pollinations) belong to
  Kana, so a question about "your voice" or "the local TTS model" is about
  Kana, not a Hermes tool or setting. Without this, Hermes answered "speak
  cutely" by calling its own `text_to_speech` tool.
- The note follows the voice (`HermesRelayOptions.voiceEnabled`, read on
  every submit). Voice on: Kana reads `ja` aloud, so Hermes must never call a
  TTS tool to speak, and makes an audio file only when asked for a file.
  Voice off: no `ja` line; a user who wants to hear Kana is pointed to
  Settings → Voice. Turning the voice on or off sends the full contract on
  the next prompt.
- The full contract also says how Hermes's config changes reach Kana
  (`config.yaml` models at once, `.env` after `/reload`, the rest after
  `/restart`) and that Hermes must never stop or restart `hermes serve`
  itself: the conversation runs on it.
- Do not send the contract as a system-role seed on `session.create`. Hermes
  sends a seed as a second system message, which some routes drop before the
  model sees it (9router + `cx/gpt-5.6-luna` counted 99 prompt tokens with a
  300-token seed, and the model answered in plain text). Hermes never stores
  the seed, so a resumed session loses it anyway.
- Hermes titles sessions from the user's words, which come first.
- Transcript restore strips the note with `unwrapKanaUserPrompt`, which also
  unwraps the protocol 1/2 `user_message` JSON wrapper.

Language rules:

- Hermes reasoning, tool names, tool arguments, and internal metadata: English.
- `ja`: always natural conversational Japanese, plain speech with no
  Markdown, emoji, URLs, or code.
- The answer: the language of the user's latest message; when that message
  has no clear language (a command, a name, code), the language of the
  user's earlier messages. Kana has no subtitle language setting and sends
  none.
- `lang`: the language actually used in the answer.
- Writing in another language affects future replies only.

The voice only ever reads Japanese. A `ja` value without Japanese script, or
a plain reply (a model that ignored the contract) that is not mostly
Japanese, becomes `speech_ja: ""`, and the reply is shown at once without a
voice. Never speak the answer text as a fallback and never make a second
translation request.

Every stored assistant message preserves the exact `speech_ja`, subtitle text,
subtitle language, emotion, and timestamp that were displayed. Rendering
history must use stored `subtitle.text`; never derive or retranslate it on
load.

## UI and UX direction

Kana uses a cozy game-menu style that follows the Clara dressing-room viewer
(itself modelled on Nintendo life-sim menus such as Animal Crossing and
Tomodachi Life), in Kana's own colours. It is soft, round, and friendly,
but it stays a calm workspace rather than an ornamental dashboard. This is a
product direction, not a temporary theme.

- Colours are Kana's originals, defined in `app/globals.css` and exposed to
  Tailwind through `@theme inline`: the white/grey neutrals (light `#f4f4f2`
  / `#ffffff`, dark `#1c1c1c` / `#242424`), the brand blue `--accent`
  `#599dc6` with `--accent-hover`, `--accent-strong`, `--on-accent`,
  `--chat-frame`, `--chat-bubble`, and the stage-pattern inks. Do not tint
  the neutrals or add new shades of blue; style through the tokens.
- No shadows of any kind: no drop shadows, no flat "ledge" shadows, no glow.
  Pieces are flat colour shapes separated by fill, radius, and spacing.
- One typeface, M PLUS Rounded 1c (`next/font/google`, variable
  `--font-kana-sans`, weights 400–800), for Latin UI text and Japanese
  subtitles alike. Headings and pills use the heavy weights (700–800).
- Components copy Clara's vocabulary (shared classes in `globals.css`):
  - header actions are a blue pill tray (`kana-bar`) of round tabs; an open
    tab turns into the white disc, and a label bubble (`kana-tip`) appears
    under a tab while it is pointed at or open;
  - the conversation title is a blue name chip;
  - buttons are heavy pills (`kana-pill`, with `kana-pill-accent` striped
    blue for primary actions and `kana-pill-soft` for secondary ones) that
    hop up on hover;
  - choices are rounded cards (`kana-choice`); the selection is a blue ring
    plus a round check badge (`kana-check`) on the corner;
  - Settings → Avatar is Clara's wardrobe (`kana-wardrobe`,
    `settings-avatar-cards.tsx`): cards wrap in a grid, never a carousel or
    rows of buttons. An avatar card is its stage portrait on a soft blue disc
    over its name; an imported one keeps its size, Rename and Remove in a ⋯
    menu on its top-left corner. Background cards are a 16:10 preview over
    the name. Each grid ends with a dashed card with a blue "+" disc that adds
    one (import Live2D, upload an image);
  - segmented controls are a pill track with a sliding blue thumb;
  - in-content section labels are small rounded bubbles
    (`kana-label-bubble`), but the Settings sidebar group labels ("Personal",
    "System") are plain muted text; disclosures lead with a round "+" / "–"
    disc; dividers are dotted;
  - dropdowns are the custom `KanaSelect`, never a native `<select>`. Long
    lists (models, and providers past eight) pass `search` for a filter field,
    and the list is `position: fixed` so dialogs never clip it;
  - Log out and other leave-the-app actions use the red `kana-pill-danger`
    with an icon;
  - icons are two-tone solid SVGs (`DuoIcon`): the main part in the current
    colour, the supporting part in the soft tone. Header: sun/moon, avatar
    layout ("Scale": a small box growing into a big one), history clock,
    settings hexagon. Settings sections: globe, waveform, avatar figure, bot
    (AI model, never a sparkle), server, shield;
  - text, number, and password fields use `kana-field`: a grey pill at rest
    that turns white with one solid accent ring while active. No browser
    field chrome at all (focus ring, search clear button, spinners, password
    reveal, autofill tint); a search field draws its own clear button;
  - the avatar layout popover has no title or hint, just reset/close and the
    Size, X, and Y sliders. Sliders are `kana-range`: a thick accent-filled
    pill with no knob, like a console volume bar;
  - modals have square corners: this is Kana's signature. That covers
    Settings, the setup screens, conversation history, the Hermes
    approval/input dialog, the connection gate, the composer's model
    chooser, and the avatar layout ("Scale") popover. The Settings sidebar items (`kana-settings-nav-item`, the
    selected one included) are square too. Controls inside a modal keep
    their rounded shapes, and the greeting dialogue box (`kana-greeting`)
    is not a modal;
  - conversation history has no "Recent" label: a dotted stroke like the
    Settings sidebar edge, inset to the search field's edges with room above
    and below, separates the search from the list. Only a search result
    count gets a label bubble;
  - Settings is to the point: a group title, then rows of a short label and
    its control. No descriptions, hints, or explainer paragraphs under
    titles, rows, cards, or buttons; if a label needs one, find a clearer
    label. The only text beyond labels is live status, errors, the voice
    clone consent, and the required Live2D sample notice. `SettingsGroup`
    takes an `action` that sits right after the title (never at the far
    right, where the dialog's close button is). Advanced configuration's
    action is the "Guide" link to `/docs`, opened in a new tab.
- `/docs` is the config guide (`components/kana/config-guide.tsx`). Its
  content is plain Markdown, one file per language in `content/docs`
  (`configuration.id.md`, `configuration.en.md`), read at build time by
  `app/docs/page.tsx` and rendered with the chat's own parser and renderer
  (`lib/presentation/markdown.ts`, `renderMarkdownBlocks` in
  `chat-markdown.tsx`), never a second Markdown library:
  - `# Title` names the page; every `## Section {#id}` is a sidebar entry
    whose id (shared by both languages, see `CONFIG_GUIDE_GROUPS`) drives
    deep links and icons; a fenced `kana-config-path` block shows this
    installation's config path; write each paragraph on one line (a single
    newline is a line break in the chat parser). Settings go in Markdown
    tables. `tests/presentation/config-guide.test.ts` checks the structure
    and runs every JSON example through the real config parser;
  - its delivery follows the Pollinations API docs
    (https://gen.pollinations.ai/docs): a one-sentence summary quote under
    the title, then bold-label key facts (**Config file:**, **Open it:**);
    a Quick start of short headings each followed straight by code; one
    section per config block that opens with one sentence, lists its keys in
    a Markdown table (Key | Default or Required | Description) and uses
    `> **Note:**` callouts; Troubleshooting last (symptom | fix, quoting
    Kana's exact messages). Short, factual, formal sentences;
  - it is written for the person using Kana, not for agents, in a formal
    register: Indonesian is baku with "Anda" (no "kamu", no slang such as
    "pakai", "kalau", "ketemu"), English is professional documentation
    without contractions. One task per heading, and why someone would change
    a setting. Each language is written on its own rather than translated
    line by line, so wording and structure may differ; the facts, section
    ids and example values stay shared. No JSON syntax lessons. Keep its
    facts in step with `lib/server/user-config.ts` and
    `docs/CONFIGURATION.md`;
  - it uses Settings' shell: the same sidebar (plain group labels, dotted
    edge, Settings' square nav items). The content is an ordinary document in one column
    (`.kana-doc`) that fills the width to the right, with no max-width, read
    top to bottom, with sections split by dotted rules. No custom layouts
    (no side-by-side steps), no cards or bento boxes; only code blocks (and
    the config path box) have a fill: always dark, in both themes
    (`.kana-code-surface` redefines the theme tokens inside), with square
    corners, not rounded;
  - headings, bold labels (`**Config file:**`) and table headers are set in
    a plain sans, Inter (`next/font/google` in `app/docs/page.tsx`, exposed
    as `--font-doc-sans`), because the user found them hard to read in the
    rounded face. Running text (paragraphs, quotes, lists, table cells,
    links) keeps the app's M PLUS Rounded 1c, as does the sidebar. Code
    stays monospace;
  - `json` code blocks are coloured by `lib/presentation/json-highlight.ts`
    (keys in Kana's blue, strings, numbers, literals; `--code-*` tokens on
    `.kana-code-surface` in `globals.css`), a small tokenizer rather than a
    highlighting library. It only splits the text, so Copy still copies the
    raw example; other languages stay plain;
  - its icons are real icons, Material Symbols Rounded from the subset font
    in `app/fonts` (`MaterialSymbol`), never the drawn two-tone `DuoIcon`
    glyphs. Add a name as `app/fonts/README.md` explains;
  - html/body stay `overflow: hidden` for the app, so the guide scrolls
    inside its `main`. Like every page it needs a signed-in session, and
    `public/sw.js` caches only `/` as the offline shell, so `/docs` never
    replaces it.
- The "Preparing Kana" loading screen (`kana-app.tsx`, before the workspace
  is ready) is always light (`data-theme="light"` on its `main`, since the
  saved theme is not applied yet): a plain page with plain text, no pattern
  and no bubble behind the label.
- First-run setup opens with Kana herself, not a modal: the header and chat
  step away, the stage clears (full screen on phones too), the avatar smiles,
  and her line types out in a game-style dialogue box (`kana-greeting`) with a
  tilted name tag. No blur, no icon, no step bar. The greeting is always
  English (`KANA_GREETING` in `lib/ui/copy.ts`, `lang="en"`), whatever the UI
  language; the setup screens that follow use the UI language and are
  numbered in the kicker text only ("Step 1 of 3").
- The chat panel is the plain tray inside the blue `--chat-frame` border:
  no texture. The composer stays the blue band with a transparent text field
  and white text; its model chooser is a white pill and Send becomes a white
  disc when there is something to send. While Hermes works, or while the
  reply's voice is still being generated, the transcript shows a chat-app
  typing bubble (`kana-typing`, three hopping dots) with the status beside
  it. Voice generation has no short time limit on the client; slow machines
  simply keep the bubble up longer.
- Hermes replies are Markdown. `ChatMarkdown` renders them through the small
  reader in `lib/presentation/markdown.ts` as React elements, never as HTML;
  links survive only for http(s) and mailto and open in a new tab, and images
  become links (Kana does not load remote pictures into chat). Long words and
  URLs wrap inside the bubble; code blocks and tables scroll inside it. The
  feed keeps `min-w-0` so one unbroken string cannot widen it past the panel.
- A turn's Hermes activity block stays open while the turn runs, even
  between tools, unless the reader closes it, and collapses when the reply
  lands (the feed remounts it under the reply's key). Finished turns start
  collapsed.
- Motion is springy (`--spring`): lift on hover, small press on click, a pop
  for check badges. Global reduced-motion rules must keep working.
- Built-in stage patterns come from `scripts/generate-stage-patterns.py`
  (edit the generator, not the SVGs). All use the blue ink. Sakura, sparkle,
  clouds, and ribbon sit on a faint blue wash and drift one tile per
  90–130 s; sakura, sparkle, and ribbon add a deeper `-detail` mask layer.
  Seigaiha stays static. Keep them calm and simple: they sit behind the avatar.
- Desktop keeps the workspace hierarchy: a thin header, the avatar as the
  centred visual focus of the stage, and the conversation tray on the right
  with the transcript and the composer at the bottom. Do not push the avatar
  into a small side card merely to expose more panels.
- On mobile, conversation history becomes a modal drawer with a backdrop, the
  workspace remains one column, and the composer stays reachable at the
  bottom. Phones and tablets (below 1024px) are chat-first: the transcript
  fills the screen and the live avatar sits in a small call-style tile at the
  top left, framed on the face and drawn like a sticker with a thick white
  stroke. Positioning the avatar temporarily expands the stage to full
  screen and fades the chat out in place (no sideways slide). Do not render
  desktop side-by-side panels at narrow widths.
- Keep touch targets accessible, prevent horizontal overflow, respect dynamic
  viewport height, and retain keyboard access to the slash-command menu,
  dropdowns, and composer.
- Activity and settings are secondary surfaces. They should not compete with
  the avatar and conversation for the primary viewport.

## Current implementation status

### Real and operational

- Next.js App Router UI with a cozy, Clara-style game-menu workspace in Kana's
  colours, centered avatar stage, framed conversation tray with the composer,
  and responsive mobile drawer layout.
- `HermesAgentClient` over the server relay: SSE event stream plus
  allow-listed JSON-RPC (`/api/hermes/events`, `/api/hermes/rpc`), session
  create/resume, prompt submission, interruption, and event translation.
- Event-driven transcript restore: `session.resume` responses carry the full
  display transcript; the adapter emits `history.restored` and the workspace
  parses it (Kana note unwrap, response header or envelope, tool rows). Selecting a
  linked conversation or auto-connecting opens the session first, so
  refreshes and fresh browsers always repopulate the transcript. Auto-connect
  lands on the most recent non-empty Hermes session instead of minting a
  blank one per visit.
- Per-turn tool activity logs in SQLite (schema v2, `turn_index` ordinal with
  idempotent v1 migration), reconstructed from restored history and mirrored
  by live turns; `LiveChatFeed` splices them by ordinal across browsers.
  Hermes stores each tool as it finishes, so when `session.resume` reports a
  turn still running, the tools after the last reply seed the live log
  (`history.restored.running`, `agent.started.resumed`): a refresh mid-turn
  keeps them on screen and they land on the reply.
- Live categorized Hermes slash catalog, command search, argument completion,
  command execution, aliases, skill/send directives, dedicated approval/title/
  branch handling, and busy-turn prompt queuing.
- Dedicated Hermes approval and clarification dialogs plus ephemeral sudo and
  secret entry. Sensitive values use uncontrolled password inputs, are sent
  directly to Hermes, and are never added to Kana history, activity details,
  preferences, or local storage.
- Kana persona and strict response parsing for Japanese speech, stored
  subtitles, language, and emotion.
- Local user preferences in browser storage; the Hermes session token is
  server-side only and never enters browser storage in any form.
- Password-based login behind a deny-by-default proxy and a single data root
  for auth/JWT/activity state. The same displayed default-password flow is
  used by npm packages, source builds, local development, and deployments.
- Browser audio decoding/playback and amplitude-based lip sync through the Web
  Audio API, with autoplay-policy timeouts and per-playback graph cleanup.
- Local Japanese speech with the pinned Irodori-TTS v4.1 Anime model on the
  prebuilt irodori-c `v0.2.0` CPU engine (no Python). The engine (~480 MB) and
  model (~3.1 GB) install only on request, resume after interruption, are
  SHA-256 verified, refuse to start without enough disk, and reuse a matching
  model from the Hugging Face cache. int8 is used on AVX-512 VNNI CPUs. Long
  speech is split to the engine's 256-token/30-second limit and joined; Kana
  emotions map to speaking-style captions; library voices are passed as
  reference WAVs (bundled Kana voice by default, or the model's own voice).
- `TtsRelayProvider` reaches the selected server provider only through the
  Kana relay (`/api/voice/tts/*`). It sends `speech_ja` as Japanese, cancels
  server work when stopped (dedicated cancel route that kills the engine
  process), decodes WAV audio, and drives Live2D lip sync. Complete WAV is the default. An opt-in
  experimental sentence mode preserves the exact text/order, prefetches the
  next part, cancels safely, and replays all cached parts without another
  Hermes request.
- A server-side TTS provider boundary keeps synthesis transport separate from
  browser playback/cache/lip sync. The local Irodori engine is the default;
  Pollinations (`tts.pollinations`) posts only its documented fields
  (`input`, `response_format`, and the configured `model`, `voice`, and
  `instructions`) with a user-owned key from owner-only `config.json`. Configs
  from the old `openai-compatible` Pollinations preset are read as
  Pollinations with that preset's defaults.
- A concrete Pixi/WebGL Live2D renderer, centered responsive canvas, emotion
  expressions, motions, talking state, and mouth-parameter updates.
- AIRI-style cursor focus: the avatar watches the pointer and drifts its gaze
  after a one-second pause. It lives entirely inside the Pixi runtime adapter
  (pointer listeners plus a ticker callback, no React state), and eye-ball
  curves are stripped from loaded motions so they cannot fight the focus
  controller's additive gaze.
- Official Haru is the default development avatar and official Mao is a second
  selectable sample with a different mouth binding (`ParamA`). Both load from
  one pinned commit of Live2D's official sample repository. The required
  copyright notice is displayed in settings; neither model is copied here.
- Haru → Mao → reload → Haru is covered by a real network/WebGL acceptance
  journey. The Pixi runtime reuses one renderer per canvas and retires model
  resources after the replacement frame, avoiding freezes and stale texture
  errors while keeping model-specific bindings persistent.
- Replaceable Live2D models can be loaded from a persistent hosted
  `.model3.json` URL or imported as a browser-selected folder persisted in
  IndexedDB. Per-model mouth, expression, and motion bindings are editable and
  keyed to the imported package or URL.
- Imported Live2D packages are validated before storage, listed with local
  sizes, selectable/renameable/deletable, and have emotion/motion/talking
  preview controls. Cubism Core executable URLs are restricted to Live2D's
  official SDK distribution path.
- Avatar cards show a portrait taken from the stage: 1.2 s after a model
  loads, `AvatarService` renders a frame and cuts the head and shoulders out
  of the canvas (`lib/avatar/portrait.ts`, head box from
  `classifyLive2DFraming`) into a 192 px WebP. Portraits stay in this browser
  (localStorage `kana.avatar.portraits.v1`, the 16 newest, keyed by imported
  model id or sample URL) and are never shipped or uploaded, so a sample shows
  the placeholder figure until it has been on stage once. Deleting an
  imported model deletes its portrait. A model replaced before it settles
  gets no portrait that time.
- Hosted model URLs can also be saved/renamed/selected/deleted in the model
  library. Per-model bindings have a separate versioned export/import format
  that never copies `.moc3`, textures, or other licensed avatar assets.
- Unexpected Hermes disconnects clear unsafe busy UI state. The next reconnect
  resumes the linked durable session, detects deleted Hermes sessions without
  silently replacing them, and can recover a completed structured response
  from `session.resume` history after a dropped turn.
- `npm run test:hermes:restart` starts the installed Hermes binary with a
  temporary isolated home, reconstructs the adapter like a page refresh,
  proves idle stop/start/reconnect/resume and `/status`, then removes only that
  temporary home. Active turn and protected input restart cases remain an
  explicit beta acceptance matrix.
- Arrow-key/Enter/Tab/Escape slash-menu navigation, mobile drawer/settings
  behavior, transcript restore after reload, and WebGL teardown were manually
  checked in the local browser at desktop and 390 × 844 mobile viewport sizes.
- First-run setup, conversation search, per-conversation drafts, linked/missing
  Hermes session markers, modal focus restoration/trapping, safe diagnostics,
  route-level error recovery, and versioned local backup/restore are present.
- Security headers include CSP, frame/object blocking, no-referrer, nosniff,
  and a restrictive permissions policy. Backup excludes Hermes credentials and
  imported avatar files, and restore merges without deleting unmatched data.
- Provider URLs are normalized before entering runtime state or backup data.
  Invalid HTTPS/loopback rules fail without replacing a previously persisted
  safe value. Unreadable persistence records are retained for recovery and the
  UI reports an explicit storage warning.
- Playwright runs critical journeys in desktop/mobile Chrome and explicitly
  checks historical subtitle preservation, slash keyboard flow, redaction,
  backup restore, onboarding, migration, avatar fallback, CSP, and
  360/390/768/1440 layouts. A production-profile test also verifies manifest
  installability and an offline mobile application shell.
- `npm run tts:acceptance` validates real WAV headers/audio, records per-sample
  short/medium/long p50/p95 and real-time factor, and tests active cancellation
  on target hardware. `npm run dogfood:check` deterministically reports the
  remaining seven-day, environment-matrix, and P0/P1 beta gates.
- `npm run dogfood:record` and `npm run dogfood:matrix` safely update sanitized
  evidence without hand-editing JSON. Active Hermes restart observations use
  `acceptance/hermes-active-restart.json` and must pass
  `npm run hermes:active-check`; neither validator turns pending evidence into
  a pass automatically.
- Next.js standalone output, installable web manifest, same-origin service
  worker shell, and `npm run package:local` package assembly are operational.
  The worker caches only the Kana shell/static assets, not cross-origin
  Hermes traffic or `/api`. Hermes and the multi-gigabyte voice engine and
  model remain outside the package by design.

### Implemented foundation but not complete end-to-end

- The local voice engine is real and verified end to end on the target laptop
  (i3-1005G1, int8), but it is CPU-only and slower than realtime there: about
  7 s for a short reply with the model voice and about 20 s with a reference
  voice, which the engine re-encodes per utterance. Linux x86-64 only; other
  hosts use Pollinations. Streaming audio is not implemented;
  sentence delivery is experimental until a VPS baseline exists.
- The local package is a self-contained web runtime, not a signed native
  desktop application. Kana's server can supervise a loopback Hermes child and
  voice engine processes, but it is not an OS-level service manager or native auto-start.

### Fixed agent/avatar modes and TTS fallbacks

- Agent and avatar modes are fixed to Hermes and Live2D. Browser voice mode is
  the configured server provider; `config.json` chooses the local Irodori engine or
  Pollinations without exposing its API key to browser state.
  `normalizeKanaPreferences` forces these presentation modes on every load and
  save, so legacy stored values cannot re-enable unsupported implementations.
- The placeholder avatar state (formerly the CSS mock preview) lives inside
  `ManagedAvatarProvider` as the honest fallback shown whenever the remote
  Cubism Core, hosted model, or imported model cannot load.

Do not describe Kana as fully connected merely because the Hermes adapter
exists. A running installation is using Hermes only when the user selects
Hermes mode and successfully connects to `hermes serve`.

## Important source locations

```text
app/page.tsx                              App entry
components/kana/kana-app.tsx             Main composition, gate/auto-connect
components/kana/live-chat-feed.tsx        Chronological message+activity feed
components/kana/chat-markdown.tsx         Markdown reply renderer (elements only)
components/kana/agent-input-dialog.tsx   Approval and secure Hermes input UI
components/kana/slash-command-menu.tsx   Slash catalog/completion UI
components/kana/kana-select.tsx          Custom dropdown (replaces native <select>)
app/globals.css                          Theme tokens and the shared game-menu classes
components/kana/kana-workspace-context.tsx Per-mount workspace provider + useKanaStore
lib/store/                                Per-concern zustand vanilla stores (created
                                          per mount by createKanaStores, never global)
lib/services/kana-workspace.ts            Wires stores and services for one workspace
lib/services/hermes-session-manager.ts    Hermes client lifecycle and session switches
lib/services/agent-event-handlers.ts      AgentEvent -> store updates
lib/services/conversation-service.ts      Working set, pointer, transcript restore
lib/services/send-message.ts              Prompt, Kana command, and slash submission
lib/services/model-catalog-service.ts     Cached Hermes model list (stale-while-revalidate, reloads on drop once shown)
lib/agent/types.ts                        Stable agent contracts/events
lib/agent/hermes/hermes-agent-client.ts   Hermes relay adapter (SSE + JSON-RPC)
lib/agent/hermes/gateway-types.ts         Hermes wire response types
lib/agent/hermes/kana-command-surface.ts  Honest surface availability mapping
lib/server/hermes-bridge.ts               Server-held gateway WS + token custody
lib/server/local-hermes-runtime.ts        hermes serve spawn/discovery control
lib/server/data-dir.ts                    KANA_DATA_DIR resolver + legacy adoption
lib/server/activity-store.ts              SQLite per-turn activity log (schema v2)
lib/server/media-links.ts                 MEDIA: path rules, signed links, relay rewrite
lib/server/media-response.ts              Range/ETag file streaming for /api/media
app/api/hermes/events                     SSE downstream relay
app/api/hermes/rpc                        Allow-listed JSON-RPC relay
app/api/kana/sessions                     session.list filtered to source "kana"
app/api/kana/activities                   Activity turn store GET/PUT
app/api/media/[token]/[name]             Delivered file download/stream
lib/server/auth/*                         Password store, JWT session, login limiter
lib/server/auth/password-command.ts       The one password command this install shows
proxy.ts                                  Deny-by-default auth proxy (Next 16)
lib/presentation/persona.ts               Persona and response instructions
lib/presentation/response-parser.ts       Structured response validation
lib/presentation/markdown.ts              Safe Markdown subset reader for replies
lib/presentation/media.ts                 Delivered-file links, kinds, and extraction
lib/backup/kana-backup.ts                  Versioned credential-free backup format
lib/avatar/avatar-controller.ts           Provider-independent avatar control
lib/avatar/defaults.ts                     Official Haru/Mao URLs and bindings
lib/avatar/live2d-avatar-provider.ts       Live2D integration boundary
lib/avatar/managed-avatar-provider.ts      Stable runtime/fallback delegation
lib/avatar/pixi-live2d-runtime-adapter.ts  Pixi/Cubism canvas implementation
lib/avatar/portrait.ts                     Stage portrait crop, capture, and local archive
lib/avatar/indexed-db-avatar-model-store.ts Imported model persistence
lib/avatar/model-bindings.ts               Per-source binding resolution
lib/avatar/binding-backup.ts               Asset-free binding import/export
lib/voice/tts-relay-provider.ts            Provider-neutral TTS playback client
shared/irodori-release.mjs                 Pinned engine/model artifacts (size + SHA-256)
lib/server/irodori/install.ts              Lazy, resumable, verified engine/model install
lib/server/irodori/synthesis.ts            Serialized engine processes, captions, joining
lib/server/tts-provider/                   Server synthesis provider boundary,
                                          local Irodori and Pollinations adapters
components/kana/voice-engine-panel.tsx     Download size/progress/remove UI
components/kana/config-guide.tsx           /docs config guide (content: content/docs/*.md)
components/kana/code-block.tsx             /docs code block and Copy button (also the login screen)
components/kana/settings-avatar-cards.tsx  Wardrobe grid, avatar card with ⋯ menu, dashed add card
components/kana/material-symbol.tsx        Material Symbols subset font (app/fonts) for /docs
lib/voice/audio-lip-sync.ts                Web Audio lip-sync mechanism
lib/preferences/local-preferences-store.ts Local settings persistence
lib/diagnostics/safe-diagnostics.ts        Redacted local diagnostics
scripts/package-standalone.mjs              Local production package assembly
scripts/hermes-restart-acceptance.ts         Isolated real-server restart audit
tests/agent/hermes-agent-client.test.ts     Adapter/control/recovery tests
tests/server/                               data-dir, auth, activity-store unit tests
tests/e2e/kana-critical-journeys.spec.ts    Desktop/mobile acceptance journeys
docs/SECURITY.md                            Local threat model and controls
docs/SUPPORTED_ENVIRONMENT.md               Tested versions + VPS deploy guide
PLAN.md                                     Active remediation plan/status
```

## Implementation plan

The phased plan below is complete; ACTIVE remediation work (bug fixes,
hardening) is tracked in `PLAN.md` —
read it before picking up work here.

Work incrementally and keep the application usable after every phase.

### Phase 1 — complete Hermes interaction controls

- [x] Add dedicated forms for Hermes clarification requests.
- [x] Add secure, non-persistent sudo-password and secret-value entry.
- [x] Audit the current Hermes command registry for dedicated RPCs that deserve
      richer Kana controls instead of plain text output, especially model,
      profile, session, usage, and configuration commands.
- [x] Present explicit explanations for genuinely messaging-only commands.
- [x] Add focused adapter tests for aliases, prefills, send/skill directives,
      queueing, interruption, approval, branch, and reconnect behavior.

### Phase 2 — real local TTS

Completed with a Qwen3-TTS Python service; on 2026-09-15 the local engine was
replaced by irodori-c with the Irodori-TTS v4.1 Anime model.

- [x] Inspect the chosen local TTS engine and freeze one versioned adapter
      contract outside React components.
- [x] Add connection/health status and voice discovery where supported.
- [x] Verify Japanese synthesis, stop/abort behavior, browser CORS, audio format,
      errors, and replay.
- [x] Keep direct-audio playback as the baseline before adding streaming.
- [x] Add an opt-in deterministic sentence-delivery experiment that retains
      one Hermes response, ordered playback, prefetch, cancellation, and replay.
- [x] Add a no-inference harness self-test and a target-host p50/p95/RTF/WAV/
      cancellation benchmark. The real hardware result remains a release gate.

### Phase 3 — real replaceable Live2D

- [x] Select a legally usable Cubism Web runtime/package after checking its
      license and compatibility with the installed Next.js version.
- [x] Implement the concrete `Live2DRuntimeAdapter` and canvas lifecycle.
- [x] Add URL-based model selection and browser folder import without assuming
      that every model uses Haru's mouth parameter ID.
- [x] Persist imported model folders across reloads; hosted model URLs already
      persist as a local user preference.
- [x] Store per-model mouth, expression, and motion bindings.
- [x] Connect emotion, talking state, motions, and Web Audio lip sync to the
      avatar provider and real local TTS output.

### Phase 4 — persistence and product hardening

- [x] Establish the minimal white desktop/mobile UI baseline with the avatar as
      the centered focal point.
- [x] Move local history to IndexedDB and retain a localStorage
      migration/fallback; do not add cloud sync prematurely.
- [x] Reconcile Kana and Hermes session lifecycle edge cases, including deleted
      or externally renamed Hermes sessions.
- [x] Maintain preference migrations through v5 for the voice settings,
      credentials, onboarding, and voice delivery mode.
- [x] Keep conversation migration idempotent for every persisted schema change
      introduced so far.
- [x] Add accessibility, keyboard navigation, responsive, and error-recovery
      tests without turning the task into an elaborate visual redesign.

### Phase 5 — optional future product work

- [ ] Add streaming TTS only if the local engine can provide a stable,
      cancellable stream and the latency improvement justifies the complexity.
- [x] Add model-library screens for listing, selecting, renaming, previewing,
      and deleting imported and hosted Live2D models.
- [ ] Consider a signed desktop wrapper only if users need process supervision,
      OS keychain integration, or native auto-start. Keep Hermes external and
      independently updatable.
- [ ] Add automated cross-browser end-to-end tests when a stable CI browser
      target is chosen; current responsive and accessibility checks are local.

## Distribution and TTS audit update (2026-09-08)

- Root `package.json` is the private source app `kana-app`; `cli/package.json`
  is the public `kana-alya` package. Keep versions equal. Generate CLI payloads
  through `npm run package:npm`; publish only through the guarded CLI path.
  `bin/` and `config/` remain the authoritative sources, not generated `cli/` copies.
- `kana` opens a local browser; `kana serve` is the foreground, headless
  deployment command. VPS users may install npm on their VPS or deploy a source
  standalone build. Both use the same config and server implementation.
- TTS replies are held in `lib/presentation/spoken-reply-queue.ts` until audio
  starts. Stop and failure reveal text; failures must remain visible in the UI.
- Config uses one `tts.provider` selector. Inactive provider settings do not
  influence active requests; cancellation follows the original request owner.
  Optional `tts.timeoutSeconds` defaults to 900.
- The local voice engine and model are pinned artifacts installed on request;
  never patch Hermes or the engine release to change behavior.
- Deployment requires one server process per data root; do not claim support
  for multiple clustered workers sharing process-held gateway/cancel state.
- See `docs/INSTALLATION.md`, `docs/CONFIGURATION.md`, and
  `docs/TTS-AUDIT-2026-09-08.md` for decisions, evidence, and remaining limits.

## Development workflow

Before coding:

1. Read this file completely.
2. Read the relevant installed Next.js guide under
   `node_modules/next/dist/docs/`.
3. Inspect the existing interface and provider before adding a new one.
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

Lightweight acceptance harness self-tests are included in `npm run quality`.
The real external gates are separate:

```bash
npm run test:hermes:restart
npm run test:live2d:official
npm run hermes:active-check
npm run dogfood:check
```

The Live2D command requires internet access to Live2D and GitHub's pinned
official assets. Local voice checks need target hardware, and dogfood
intentionally fails until seven real days and every required matrix case have
evidence.

For Hermes changes, also test against a temporary `hermes serve` instance on a
non-default port. Use a unique `source: "kana"` test session, close it, and
remove only test data created by that check. Never delete or alter existing
user sessions.

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
- lint, TypeScript, and production build pass in proportion to the change.

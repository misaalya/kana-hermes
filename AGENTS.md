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
- The browser never holds a Hermes session token. The Kana server mints or
  discovers it, keeps it in process memory, and the browser reaches Hermes
  only through `/api/hermes/*`.
- All server-side persistent state (auth hash, JWT secret, activities DB)
  lives under ONE data root resolved by `lib/server/data-dir.ts`
  (`KANA_DATA_DIR` → XDG → HOME). Never introduce a new `$CWD`-relative
  storage location.
- Do not hardcode a single Live2D model or third-party copyrighted character.
- Do not hardcode Indonesian as the subtitle language.
- Do not retranslate old conversation history when the current subtitle
  language changes.
- Do not add a dependency until the existing project and browser APIs have been
  checked for an equivalent capability.
- Kana has no second mock agent, voice, or conversation-store provider; modes
  are fixed to Hermes, Qwen3-TTS, and Live2D, and integrations must fail
  honestly when their external service is unavailable.

## Hermes environment and safety

The user-owned executable is:

```text
/home/kenobu/.local/bin/hermes
```

The source currently available for read-only inspection is:

```text
/home/kenobu/.hermes/hermes-agent
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
```

- The browser authenticates with its Kana session cookie; the Hermes session
  token stays inside the server process (`lib/server/hermes-bridge.ts`).
- Transcript authority is Hermes: restoring a conversation parses the
  `messages` returned by `session.resume` (emitted to the UI as the
  `history.restored` agent event). `session.history` accepts only the RUNTIME
  session id, never the durable key, and is a fallback only.
- Per-turn tool activity logs live in SQLite (`activities.db`) keyed by the
  durable Hermes session plus a zero-based assistant-reply ordinal
  (`turn_index`, schema v2). They are reconstructed from restored history and
  mirrored by live turns through `/api/kana/activities`.
- All persistent server state — auth hash, JWT secret, activities DB — lives
  under one data root resolved by `lib/server/data-dir.ts`
  (`KANA_DATA_DIR` → XDG → HOME; production fails loudly without it). Legacy
  files from `$HOME/.kana` / `$CWD/data` are adopted on first use.
- Login is password-based with a deny-by-default proxy. Production without
  auth config surfaces `insecureNoAuth` (header + auth status) and logs
  loudly unless `KANA_ALLOW_NO_AUTH=1`. Local process-control routes trust a
  shared-secret header (`KANA_TRUSTED_PROXY_SECRET`), not a spoofable flag.
- The Qwen3-TTS Python service is spawned/probed by the Node runtime and
  reached by the browser only through `/api/voice/tts/*` relay routes,
  including request cancellation.

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
  Kana response envelope. They must not trigger a second model.
- `/approve` and `/deny` use `approval.respond`; `/title` and `/branch` use
  their dedicated session RPCs.
- `/save`, `/status`, `/compress`, `/steer`, and `/handoff` use dedicated
  Hermes RPCs rather than parsing terminal text.
- `/new`, `/sessions`, and `/resume` are surface-aware Kana conversation
  actions. Each Kana conversation retains its linked durable Hermes session.
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
turn:

```ts
type KanaResponse = {
  speech_ja: string;
  subtitle: {
    text: string;
    language: string;
  };
  emotion?: Emotion;
};
```

Language rules:

- Hermes reasoning, tool names, tool arguments, and internal metadata: English.
- `speech_ja`: always natural conversational Japanese.
- `subtitle.text`: the user's selected language for that new response.
- `subtitle.language`: the language actually used in `subtitle.text`.
- Changing the preference affects future messages only.

Every stored assistant message preserves the exact `speech_ja`, subtitle text,
subtitle language, emotion, and timestamp that were displayed. Rendering
history must use stored `subtitle.text`; never derive or retranslate it on
load.

## UI and UX direction

Kana uses a restrained, white, Codex-inspired workspace rather than an
ornamental dashboard. This is a product direction, not a temporary theme.

- White is the base color. Use neutral grays for hierarchy and reserve color
  for status, errors, avatar content, and other meaningful state.
- Desktop uses a quiet conversation sidebar, a thin workspace header, a
  centered avatar stage, an inline conversation transcript, and a floating
  bottom composer.
- The avatar remains the visual focus in the center of the workspace. Do not
  push it into a small side card merely to expose more panels.
- Prefer typography, spacing, borders, and subtle surface contrast over
  gradients, decorative orbits, heavy glass effects, or large shadows.
- Preserve the Codex-like information hierarchy without copying OpenAI assets,
  logos, or proprietary visuals.
- On mobile, the conversation sidebar becomes a modal drawer with a backdrop,
  the workspace remains one column, and the composer stays reachable at the
  bottom. Do not render desktop side-by-side panels at narrow widths.
- Keep touch targets accessible, prevent horizontal overflow, respect dynamic
  viewport height, and retain keyboard access to the slash-command menu and
  composer.
- Activity and settings are secondary surfaces. They should not compete with
  the avatar and conversation for the primary viewport.

## Current implementation status

### Real and operational

- Next.js App Router UI with a minimal white workspace, centered avatar stage,
  Codex-inspired conversation sidebar/composer hierarchy, and responsive
  mobile drawer layout.
- `HermesAgentClient` over the server relay: SSE event stream plus
  allow-listed JSON-RPC (`/api/hermes/events`, `/api/hermes/rpc`), session
  create/resume, prompt submission, interruption, and event translation.
- Event-driven transcript restore: `session.resume` responses carry the full
  display transcript; the adapter emits `history.restored` and the controller
  parses it (kana_request unwrap, response envelope, tool rows). Selecting a
  linked conversation or auto-connecting opens the session first, so
  refreshes and fresh browsers always repopulate the transcript. Auto-connect
  lands on the most recent non-empty Hermes session instead of minting a
  blank one per visit.
- Per-turn tool activity logs in SQLite (schema v2, `turn_index` ordinal with
  idempotent v1 migration), reconstructed from restored history and mirrored
  by live turns; `LiveChatFeed` splices them by ordinal across browsers.
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
- Password-based login behind a deny-by-default proxy, single data root for
  auth/JWT/activity state, production no-auth surfacing (`insecureNoAuth`),
  and a shared-secret trusted-proxy model — see the custody section above.
- Browser audio decoding/playback and amplitude-based lip sync through the Web
  Audio API, with autoplay-policy timeouts and per-playback graph cleanup.
- A versioned local Qwen3-TTS API service backed by the official
  `qwen-tts==0.1.1` package and pinned official 0.6B CustomVoice model. It
  exposes health, voice discovery, Japanese WAV synthesis, request
  cancellation, local-only CORS, and a CPU-safe default.
- `Qwen3TTSProvider` reaches the service only through the Kana relay
  (`/api/voice/tts/*`), checks API compatibility, discovers live voices,
  sends `speech_ja` as Japanese, cancels server work when stopped (dedicated
  cancel route + upstream abort propagation), decodes WAV audio, and drives
  Live2D lip sync. Complete WAV is the default. An opt-in
  experimental sentence mode preserves the exact text/order, prefetches the
  next part, cancels safely, and replays all cached parts without another
  Hermes request.
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
  Hermes/Qwen traffic or `/api`. Hermes and the multi-gigabyte Qwen
  runtime/cache remain external by design.

### Implemented foundation but not complete end-to-end

- The Qwen3-TTS service is real and verified, but its Python environment and
  2.3 GB model cache are intentionally separate from the Next.js install. The
  target machine defaults to CPU because its 2 GB MX330 cannot hold the model;
  generation is functional but slower than realtime. Streaming audio is not
  implemented; sentence delivery is experimental until a VPS baseline exists.
- The local package is a self-contained web runtime, not a signed native
  desktop application. It does not start or supervise Hermes/Qwen processes.

### Fixed modes and fallbacks

- Agent, voice, and avatar modes are fixed to Hermes, Qwen3-TTS, and Live2D.
  `normalizeKanaPreferences` forces these values on every load and save, so
  legacy stored values cannot re-enable anything else.
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
components/kana/agent-input-dialog.tsx   Approval and secure Hermes input UI
components/kana/slash-command-menu.tsx   Slash catalog/completion UI
lib/state/use-kana-controller.ts          Application orchestration (god hook;
                                          zustand slice refactor tracked in PLAN.md)
lib/agent/types.ts                        Stable agent contracts/events
lib/agent/hermes/hermes-agent-client.ts   Hermes relay adapter (SSE + JSON-RPC)
lib/agent/hermes/gateway-types.ts         Hermes wire response types
lib/agent/hermes/gateway-url.ts           Relay URL normalization
lib/agent/hermes/kana-command-surface.ts  Honest surface availability mapping
lib/server/hermes-bridge.ts               Server-held gateway WS + token custody
lib/server/local-hermes-runtime.ts        hermes serve spawn/discovery control
lib/server/data-dir.ts                    KANA_DATA_DIR resolver + legacy adoption
lib/server/activity-store.ts              SQLite per-turn activity log (schema v2)
app/api/hermes/events                     SSE downstream relay
app/api/hermes/rpc                        Allow-listed JSON-RPC relay
app/api/kana/sessions                     session.list filtered to source "kana"
app/api/kana/activities                   Activity turn store GET/PUT
lib/server/auth/*                         Password store, JWT session, loopback,
                                          login limiter
proxy.ts                                  Deny-by-default auth proxy (Next 16)
lib/presentation/persona.ts               Persona and response instructions
lib/presentation/response-parser.ts       Structured response validation
lib/conversation/memory-conversation-store.ts In-memory conversation state
                                          (transcripts live in Hermes)
lib/backup/kana-backup.ts                  Versioned credential-free backup format
lib/avatar/avatar-controller.ts           Provider-independent avatar control
lib/avatar/defaults.ts                     Official Haru/Mao URLs and bindings
lib/avatar/live2d-avatar-provider.ts       Live2D integration boundary
lib/avatar/managed-avatar-provider.ts      Stable runtime/fallback delegation
lib/avatar/pixi-live2d-runtime-adapter.ts  Pixi/Cubism canvas implementation
lib/avatar/indexed-db-avatar-model-store.ts Imported model persistence
lib/avatar/model-bindings.ts               Per-source binding resolution
lib/avatar/binding-backup.ts               Asset-free binding import/export
lib/voice/qwen3-tts-contract.ts            Versioned browser/service protocol
lib/voice/qwen3-tts-provider.ts            TTS client via /api/voice/tts relay
lib/server/tts-relay.ts                    Relay helpers (session + port guard)
lib/server/local-qwen3-tts-runtime.ts      Python service spawn/probe control
lib/voice/audio-lip-sync.ts                Web Audio lip-sync mechanism
lib/preferences/local-preferences-store.ts Local settings persistence
lib/diagnostics/safe-diagnostics.ts        Redacted local diagnostics
services/qwen3-tts/                         Official-model local Python service
scripts/package-standalone.mjs              Local production package assembly
scripts/hermes-restart-acceptance.ts         Isolated real-server restart audit
scripts/qwen3-tts-acceptance.mjs             Target-host latency/cancel evidence
tests/agent/hermes-agent-client.test.ts     Adapter/control/recovery tests
tests/server/                               data-dir, trusted-proxy, auth,
                                            activity-store unit tests
tests/e2e/kana-critical-journeys.spec.ts    Desktop/mobile acceptance journeys
docs/SECURITY.md                            Local threat model and controls
docs/SUPPORTED_ENVIRONMENT.md               Tested versions + VPS deploy guide
PLAN.md                                     Active remediation plan/status
```

## Implementation plan

The phased plan below is complete; ACTIVE remediation work (bug fixes,
hardening, the deferred zustand slice refactor) is tracked in `PLAN.md` —
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

### Phase 2 — real Qwen3-TTS

- [x] Inspect the chosen local Qwen3-TTS server and freeze one versioned adapter
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
      avatar provider and real Qwen3-TTS output.

### Phase 4 — persistence and product hardening

- [x] Establish the minimal white desktop/mobile UI baseline with the avatar as
      the centered focal point.
- [x] Move local history to IndexedDB and retain a localStorage
      migration/fallback; do not add cloud sync prematurely.
- [x] Reconcile Kana and Hermes session lifecycle edge cases, including deleted
      or externally renamed Hermes sessions.
- [x] Maintain preference migrations through v5 for the versioned Qwen3-TTS
      URL contract, credentials, onboarding, and voice delivery mode.
- [x] Keep conversation migration idempotent for every persisted schema change
      introduced so far.
- [x] Add accessibility, keyboard navigation, responsive, and error-recovery
      tests without turning the task into an elaborate visual redesign.

### Phase 5 — optional future product work

- [ ] Add streaming TTS only if the chosen Qwen server can provide a stable,
      cancellable stream and the latency improvement justifies the complexity.
- [x] Add model-library screens for listing, selecting, renaming, previewing,
      and deleting imported and hosted Live2D models.
- [ ] Consider a signed desktop wrapper only if users need process supervision,
      OS keychain integration, or native auto-start. Keep Hermes external and
      independently updatable.
- [ ] Add automated cross-browser end-to-end tests when a stable CI browser
      target is chosen; current responsive and accessibility checks are local.

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
npm run tts:acceptance
npm run hermes:active-check
npm run dogfood:check
```

The Live2D command requires internet access to Live2D and GitHub's pinned
official assets. The Qwen benchmark needs target hardware, and dogfood
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

# Changelog

## 0.5.0 — 2026-10-19

### Added

- Kana tells you when a newer version is published. A notice in the workspace
  corner reads "New Version Available"; both versions and the install command
  live in its tooltip. Copying it opens the manual-update dialog, so Kana never
  stops before you really hold the command, and Copy & Shutdown ends the relay
  streams first and then this process, which a supervisor can restart. Kana runs
  nothing itself, and the corner notices share one wrapper so the
  degraded-service banner and the update notice stack instead of painting over
  each other. The registry is read on the server, at most once an hour per
  process, and a failed lookup is retried after five minutes instead of being
  cached as "no update".
- A conversation can run without the avatar. Settings → Avatar opens with the
  one row "Show avatar"; off keeps the room's pattern as the wallpaper and gives
  the conversation a centred 720px column on a desktop, while a phone keeps its
  full-bleed chat. The avatar layer is hidden rather than removed, so the WebGL
  runtime and the loaded model survive; the chat can no longer be hidden while
  the avatar is off, and Kana's first-run greeting still shows the stage. The
  avatar library, its import, and the model licence wait for the avatar to be
  on, so nothing loads a model list that cannot be used.
- Every message carries a copy button below its bubble: a reply on the left where
  the reply starts, your own message on the right beside its timestamp. A reply
  keeps its button on screen; your own message keeps it quiet on a device with a
  pointer until that message is hovered or keyboard-focused, while a touch
  screen, which can never point, keeps it visible. A reply copies the words on
  screen, so the `MEDIA:` links that became a player or download buttons are
  stripped before the clipboard sees them, and a refused clipboard selects the
  text instead of claiming the copy happened.
- On a desktop the composer recalls what this conversation has already sent:
  ArrowUp walks back through the prompts and ArrowDown walks forward, keeping the
  draft you were typing and putting it back after the newest prompt. Typing ends
  the walk. A phone, and a caret that still has a line to move to, keep the arrow
  keys for the caret.
- Enter runs the command Hermes already matched. `complete.slash` returns the
  nearest name for a typed fragment, so `/codex-run` is confirmed and sent as
  `/codex-runtime` instead of reaching Hermes as an unknown command. A name that
  is itself a suggestion is never rewritten, so a destructive confirmation always
  names the command that runs; only the name is substituted, never a completion's
  argument fallback, and the transcript shows what actually ran.
- Hermes 0.21 is answered in its own shape. `clarify.request` arrives as
  `{questions: [{qid, ...}]}` in 0.21 and flat in 0.20; Kana parses both, answers
  a batch with one `clarify.respond` per question, handles `clarify.expire`, and
  replays `pending_clarify` from `session.resume`. The dialog shows one to five
  questions with single or multiple choice and free text, picks a choice with a
  letter key, submits a typed answer with Ctrl/Cmd+Enter, waits for at least one
  answer before Send, and keeps its footer in view instead of asking you to
  scroll for it.
- A blocking dialog survives a refresh. Hermes 0.21 replays `pending_approval`
  and `pending_clarify`, but a sudo or secret prompt has no server-side replay,
  so Kana falls back to its own per-session memory of the request and the agent
  is no longer stranded until its timeout with nothing to answer. Only request
  metadata is remembered, never an answer, a password, or a secret value; a
  remembered request is dropped when the turn ends, when it is answered, or when
  it expires. An answer Hermes reports as `expired` surfaces as a failure.

### Changed

- The server's files moved into one dot directory beside the other agent tools
  you install: `KANA_DATA_DIR` when it is set, otherwise `~/.kana`. Earlier roots
  are moved in on the first start; the migration notes below carry the detail.
- The approval dialog uses the clarify dialog's shell: a square panel whose
  header, body, and footer stay put while the command scrolls between them, with
  the command on the dark code block Kana already uses in the config guide, where
  the markers for hidden characters stay legible in both themes. Phone answers
  pair two by two, Deny stays its own icon at the right edge, the lasting
  approving answer fills what Deny leaves, and Enter runs the command once the
  dialog is armed.
- The chat is readable on a phone: the reply is 13px, the same size as on a
  desktop, the timestamp 10px, and the Hermes note row steps up with it.
- Settings → Connection shows Hermes as one status card: the state as a pill, the
  port beneath it, and the single action that fits the current state, with the
  explanations in the pill's tooltip instead of a row of prose. Restart and stop
  ask once before acting, a Hermes Kana only adopted reads "Not managed by Kana",
  and a start or stop in flight is followed until it settles.
- Smaller corrections: the assistant status line sits under the typing bubble
  instead of beside it, the composer's send button uses the requested arrow, the
  model chip carries the model glyph and a real chevron, a tapped header tab no
  longer looks open on a phone, and the phone avatar fades between its sizes
  instead of stretching between them.
- `docs/` is now a map plus agent guides, operator guides, numbered decisions,
  and local evidence, and every document opens with what it is for and the files
  that decide its behaviour; `AGENTS.md` routes into it and keeps only the rules,
  contracts, and procedures that must not drift. The README's screenshots come
  from `npm run screenshots:readme`, which drives the real UI against a stand-in
  Hermes, and the "Why Kana" section is gone so the README opens on a working
  Quick start.

### Fixed

- Both fatal pages were drawn with classes that no stylesheet defined, so a
  failure was reported on an unstyled page that also promised safe diagnostics no
  surface offered. They now use Kana's own vocabulary, follow the stored theme
  and locale, and ask Next.js to `retry` the segment rather than merely
  re-rendering it.
- A Next dist directory that `.gitignore` did not name could leave Tailwind
  reading Turbopack's cache, where a class name sitting on a blob boundary comes
  back with control bytes inside it and fails the whole stylesheet build, taking
  every page down with it. `.gitignore` and the `@source not` rule now cover the
  `.next*` family together.
- The phone avatar canvas resized inside `requestAnimationFrame`, so one frame
  could paint the grown stage with the old backing store stretched over it and
  read as a blurred avatar; the resize now runs in the `ResizeObserver` callback,
  before paint. The fade that hid the stretch is gone with it.
- The phone's avatar layout panel no longer appears over a half-faded chat, and
  it no longer fades under reduced motion.
- The hand-written `:hover` rules now live inside `@media (hover: hover)`, so a
  phone, which keeps `:hover` on whatever was tapped, no longer draws a closed
  header tab as if it were open.

### Security

- A fatal error page copies only a redacted snapshot of the failure: the route
  without its query values, the redacted error name and message, and the digest.
  Nothing from the workspace stores is included, because those are exactly what
  failed to load, and a refused clipboard write shows the snapshot in a
  selectable block instead of failing silently.
- Moving a user's files has no undo, so the whole-root migration accepts a
  directory as an earlier Kana root only when it holds `appstate.db`,
  `activities.db`, `jwt-secret`, `voices/`, or `irodori/` — files Kana itself
  writes. `config.json` and `auth.json` alone no longer qualify a directory, so
  an unrelated project folder is never taken for Kana's root.

### Removed

- The tracked local debug server (`scripts/debug-server.mjs`); that work is now
  the dev server against an isolated dist directory.
- `PLAN.md` and the two local release-evidence files leave the tracked tree.
  Every command around that evidence still works on a checkout that has none: the
  dogfood recorder writes the first journal when it is missing, and a gate names
  the command or document that produces an absent file instead of failing on a
  bare `ENOENT`.
- Eleven exports with no caller, eight copy keys with no caller in either locale,
  and CSS that declared variables pointing at keyframes that do not exist.

### Migration notes

- The data root resolves as `KANA_DATA_DIR` when it is set, otherwise `~/.kana`.
  The 0.4.x line resolved `$XDG_DATA_HOME/kana` first and `~/.local/share/kana`
  last, which kept Kana's password hash, settings, voice library, and voice
  engine under a path the user never chose. The first start of 0.5.0 moves what
  an earlier root holds into the resolved root: `config.json`, `auth.json`,
  `jwt-secret`, `appstate.db`, `activities.db`, the `voices/` library, and an
  engine under `irodori/`. A file already in the target wins, the newest copy
  wins when two earlier roots hold a name, a database moves with its journal
  files, and a directory moves whole.
- The move runs once per process — in the launcher before any command and in the
  server on first store access — and never throws, because a legacy root another
  account owns must not block a start. It happens only when Kana resolved its own
  default root, so an operator-set `KANA_DATA_DIR` is used as it is and a test or
  capture run pointed at a temporary directory cannot touch your own install.
- Accepted cost: an install whose earlier root holds nothing but `config.json` is
  left where it is and receives a fresh default. A password survives either way,
  because the per-file adoption of `auth.json` is not gated by recognition.
  `docs/decisions/0003-data-root.md` records the reasoning.

### Known limitations

- Field validation is incomplete and is published as it stands. The dogfood
  journal has 0 of 7 recorded days and 6 of 13 required matrix cases pending —
  `hermes-only`, `hermes-local-voice`, `custom-live2d-model-a`,
  `custom-live2d-model-b`, `hermes-restart-active`, and
  `voice-cancel-and-replay` — so this release makes no extended-compatibility
  claim.
- Hermes 0.21's batch clarify and its replayed pending input are implemented from
  its documented protocol. The tested baseline is Hermes 0.20.1, and no 0.21
  install has validated them here.
- Local speech latency on small CPUs, the opt-in sentence delivery, and the
  browser-local avatar packages and preferences are unchanged; the supported
  environment document carries the measured numbers.

## 0.4.1 — 2026-09-26

### Security

- A web page can no longer reach a local Kana through DNS rebinding. In local
  mode Kana answers only at `localhost`, `127.0.0.1`, and `[::1]`; a request
  addressed to any other name gets 421. To open a local Kana under another
  name, add it to `KANA_TRUSTED_ORIGINS`. Deployment mode is unchanged.
- An approval can no longer be given by accident. The dialog opens with focus
  on itself instead of **Run once**, so Enter or Space pressed as it appears
  does nothing, and the approve buttons stay disabled for 0.6 seconds (Deny
  works at once).
- The approval dialog shows the whole command. Long commands wrap instead of
  scrolling sideways, and long runs of spaces, stacked blank lines, and
  invisible or bidirectional-control characters are marked in red with a
  warning, so none of them can hide part of the command.
- Wrong current passwords on a password change count against the login
  limiter, like failed logins.
- `hermes serve` started by Kana no longer inherits Kana's own `KANA_*`
  settings, `KANA_JWT_SECRET` included.
- Files Hermes names with `MEDIA:` are no longer delivered from credential
  files and shell histories in the home folder (`.npmrc`, `.git-credentials`,
  `.netrc`, keyrings, browser profiles, `.bash_history`, and similar).

## 0.4.0 — 2026-09-26

### Removed

- Versions 0.2.0-alpha.1 through 0.3.2 were removed from npm because they
  contained details of the machine they were built on. Install 0.4.0 or
  later.

### Added

- `/docs`: a configuration guide inside Kana, written as Markdown
  (`content/docs`) separately in formal Indonesian and English and rendered
  with the chat's Markdown renderer. It shows where this installation's
  `config.json` is and explains each setting with an example to copy.
  Settings → Connection → Advanced configuration links to it.
- Files Hermes sends appear in the chat. A reply with `MEDIA:/path/to/file`
  (Hermes's way of attaching a file, used by its voice, screenshot, and MCP
  tools) now shows an audio or video player, an image preview, or the file
  name, each with a Download button, instead of the raw path. Kana's server
  swaps the path for a signed `/api/media/…` link before it reaches the
  browser and streams the file with seeking support. It serves only existing
  files outside credential and system folders (the same rule Hermes uses for
  Telegram and Discord), and never Kana's own data.
- `/restart` restarts the `hermes serve` Kana started and puts you back on
  the same conversation, so a change Hermes reads only at startup applies
  without leaving Kana. (Hermes's own `/restart` restarts its messaging
  gateway for Telegram or Discord, not the server Kana uses.) Kana does not
  restart a Hermes it did not start, and waits for a reply to finish. The
  Restart button in Settings now also reconnects the open conversation at
  once. Hermes is told that models added to `config.yaml` appear in Kana
  right away, that `.env` changes need `/reload`, and never to restart the
  server itself.

### Changed

- A new look in Kana's own white, grey, and blue, with no shadows: rounded
  M PLUS Rounded 1c type, a pill tab bar, choice cards with a ring and a
  check, and sliding segmented controls. Every dropdown is Kana's own and
  can be searched, which helps with long model lists. The first run opens
  with Kana greeting you in a dialogue box, and a typing bubble shows while
  Hermes works or the voice is still being made.
- Hermes's replies are shown as Markdown: headings, lists, tables, code,
  quotes, and http(s) and mailto links. Kana never renders raw HTML from a
  reply, and long lines wrap instead of being cut off.
- **Breaking:** external voice is now a dedicated Pollinations integration
  (`"provider": "pollinations"` with a `tts.pollinations` block: `apiKey`,
  `model`, `voice`, `instructions`, `format`) instead of a preset over a
  generic OpenAI-compatible adapter. Kana sends Pollinations' documented
  `instructions` field (the old preset sent `instruct`) and allows its
  10,000-character input. Configs using the old Pollinations preset keep
  working; other `openai-compatible` endpoints are no longer supported.
- Hermes now answers Kana with a short header (`ja`, `emotion`, `lang`
  between `---` lines) followed by the answer as Markdown, instead of a JSON
  envelope (response protocol 3). It costs fewer tokens: the answer is no
  longer quoted and escaped. Replies in the old JSON format are still read.
- Kana now tells Hermes what Kana is and whether its voice is on. Hermes
  knows the avatar, the chat, the settings, and the voice (Irodori or
  Pollinations) are Kana's, so "speak cutely" or a question about the local
  voice model is answered as Kana instead of with Hermes's own
  `text_to_speech` tool. With the voice off, Hermes no longer writes the
  Japanese speech line, which saves tokens; turning the voice on or off
  updates Hermes on the next message.
- Dialogs and the login card have square corners, Kana's signature; the
  buttons and fields inside them stay rounded. The history list drops its
  "Recent" label for a dotted divider, like the one in Settings. The browser
  tab shows Kana's portrait (`public/kana-hermes.png`, 192 px).
- The "Set a password first" screen is one sentence and one command: the
  command for how Kana was installed (`kana password`, `npm run password` in
  a source checkout, or `node bin/kana.mjs password` in a standalone
  deployment), in the same code block as /docs with a Copy button. It no
  longer shows raw backticks, and the sign-in form appears by itself a few
  seconds after the password is created.
- Settings → Avatar is a wardrobe, like the Clara dressing room. Every avatar
  is a card with its portrait and name; the chosen one has a blue ring and a
  check. Kana takes the portrait from the stage a moment after an avatar
  appears and keeps it in this browser only. An imported avatar's size,
  Rename, and Remove are in the card's ⋯ menu. Stage backgrounds are a grid
  of cards instead of a carousel with arrows, and each grid ends with a
  dashed "+" card to import a Live2D folder or upload an image.

### Fixed

- Refreshing the page while Hermes works keeps the activity list of the
  running reply. Refreshing during the first reply of a new conversation
  reopens that conversation instead of a blank chat and a second history
  entry.
- Kana no longer replaces the title Hermes gives a conversation, unless you
  chose one with `/new <title>`.
- Switching to a model of a custom provider (such as `custom:9router`) no
  longer fails with an unknown provider.
- Closing a dialog no longer takes the focus back after you moved on, so an
  Enter meant for the composer cannot reopen Settings.
- A reply whose voice is still being made keeps its Stop button and progress
  when a voice check finishes in the background.
- Kana's voice spoke Indonesian or English instead of Japanese with some
  models (GPT 5.6 Luna through 9router). Kana's response contract was sent as
  a system message when the session opened; that route dropped it, so the
  model answered in plain text and Kana read that text aloud. The contract
  now travels with the user's messages (in full on the first message after a
  session opens, as a short reminder after that), and the voice only ever
  reads Japanese: a reply without Japanese speech is shown without a voice.
- A new conversation (New moment or `/new`) opens its own Hermes session
  straight away, so the model chip shows Hermes's default model instead of
  the previous session's pick until the first message. Model changes always
  apply to the open conversation's session, never the one before it.
- A model switch that worked no longer shows Hermes's model-listing notes
  ("could not reach this custom endpoint's model listing", "was not found in
  … listing"). They appear when a slow `/models` endpoint times out Hermes's
  check and read like a failure; the model chooser now says the model was
  changed. Other Hermes warnings, and the reason for a switch that failed,
  are still shown.
- `/reload`, `/reload-mcp`, and `/reload-skills` now reach the Hermes server
  Kana uses. They ran in a separate Hermes worker, so a new key in
  `~/.hermes/.env` or a new MCP server stayed unused, and `/reload` could
  fail with "Unsupported Hermes method."
- After Hermes restarted, Kana could retry the lost session forever. It now
  opens a new session on the next message when Hermes never stored the old
  one (no message sent yet), and says so when a stored session is gone.
- Other open Kana tabs now notice a Hermes restart and reconnect.
- After a conversation was restored, Kana's own notes (a command and its
  answer) could jump above the restored messages. They stay where they were.

## 0.3.2 — 2026-09-16

### Fixed

- A `hermes serve` started by Kana now runs in the home directory of the user
  running Kana instead of inheriting Kana's own working directory. For the
  npm launcher that directory was the package's runtime folder inside
  `node_modules`, so Hermes file and terminal tools worked there and anything
  written was lost on `npm update -g kana-alya`. `hermes.workingDirectory` in
  `config.json` still overrides it.

## 0.3.1 — 2026-09-16

### Changed

- The npm package's homepage now points to <https://kana.vvo.me> and its
  description names the Live2D face, Japanese voice, and subtitles. No code
  changed since 0.3.0.

## 0.3.0 — 2026-09-16

### Security

- **Breaking:** no default access password. Kana refuses logins until the
  owner runs `kana password` (or answers the first-run prompt of `kana` /
  `kana serve`). Installations that relied on the old built-in password must
  set one after upgrading; stored bcrypt hashes keep working and are upgraded
  to scrypt on the next login.
- Cross-site request guard: state-changing requests must come from Kana's own
  origin.
- Login lockout no longer lets anyone lock out every user: previously signed-in
  browsers keep their own bucket (device cookie); no IP-based buckets.
- Logout revokes the session token server-side.

### Changed

- Workspace state moved from one large React hook to per-concern zustand
  stores and plain service classes. Nothing changes for users; typing in the
  composer now re-renders only the composer instead of the whole workspace
  component and header.
- The model picker and the composer's model button open with the last Hermes
  model list at once and refresh it in the background; `/model` completion no
  longer asks Hermes for the list on every keystroke. Switching models, a new
  session, or a lost connection drops the saved list.
- **Chat-first phone and tablet layout.** Below 1024px the conversation fills
  the screen and Kana appears in a small call-style tile at the top left,
  framed closer on the face. Positioning the avatar still expands the stage to
  full screen while you drag.
- **Local voice now uses Irodori TTS instead of Qwen3-TTS.** Japanese speech
  comes from the Irodori-TTS v4.1 Anime model on the irodori-c CPU engine: no
  Python, `uv`, or GPU. The Qwen3-TTS service, its `uv` setup, and its routes
  are removed.
  - **Nothing downloads unless you ask.** Starting Kana or turning voice on
    downloads nothing. Settings → Voice shows the size (about 480 MB engine +
    3.1 GB model), free disk space, and a Download button with progress,
    cancel, and remove. Downloads resume after interruption, every file is
    pinned by size and SHA-256, and a matching model already in the Hugging Face
    cache is reused instead of downloaded. A cancelled download can be removed
    from the same panel, and first-run setup says plainly when this device
    cannot run the local engine instead of offering a download.
  - Voice is off by default on new installs. Until the engine is installed, a
    speech request fails immediately and the reply is shown as text.
  - Kana's emotions become speaking-style captions, long replies are split into
    engine-sized parts and joined, and the int8 path is used automatically on
    AVX-512 VNNI CPUs. The voice library offers the bundled Kana voice, the
    model's own faster voice, and consented reference samples (WAV, up to 15 s).
  - `config.json`: `tts.provider` is `irodori-local` or `openai-compatible`;
    local options live in `tts.irodoriLocal` (`steps`, `precision`, `threads`,
    `modelPath`, `installDirectory`). An existing `qwen3-local` setting now
    selects the local Irodori engine; the old `qwen3Local` block is ignored.
    Existing voice selections return to the bundled Kana voice, and Qwen's own
    data under the Kana data folder (`qwen3-tts`, `qwen-runtime`,
    `qwen3-tts-cache`) is no longer used and can be deleted.
  - Local voice requires Linux x86-64 with glibc 2.35+ and an AVX2 CPU; other
    hosts use an OpenAI-compatible provider.
- **Subtitles follow the language you write in.** The subtitle language setting
  is removed from Settings and first-run setup. Hermes is told to write each
  subtitle in the language of the user's latest message (keeping the earlier
  language for commands, names, or code), and Kana no longer sends a language
  in `kana_request` (response protocol version 2) or rejects replies whose
  subtitle language differs from a setting. Stored subtitles are unchanged,
  and older preferences, conversation pointers, and backups still load.

- Redesigned launcher output and help; new `kana password` command. A
  checkout runs `npm run package:local`, then `node bin/kana.mjs`; standalone
  deployments ship the launcher next to `server.js`.
- Hermes discovery reads `/proc` directly (no `pgrep`), recognises every
  `hermes serve` shape Hermes itself does, covers pipx/uv/Nix/Homebrew/root
  installer layouts, and re-discovers an adopted gateway whose token changed.
- `config.json` is cached per file change; an invalid file is reported in
  Settings instead of breaking the login and readiness probe.
- Request-size limits live in one module; voice references above Next's proxy
  buffer were previously truncated silently.
- Packaging copies services and assets from `git ls-files`; publishing refuses
  a dirty tree and runs lint, typecheck, and unit tests.

### Fixed

- Stopping `kana` with Ctrl+C or `kana serve` with SIGTERM (for example
  `systemctl stop`) exits cleanly instead of reporting that the web server
  stopped unexpectedly.
- A new conversation whose Hermes session never received a prompt no longer
  gets stuck on "session no longer exists" after Hermes restarts.
- Buttons and form fields use their intended text sizes and weights, and
  border colors (`border-accent`, `border-transparent`, …) apply everywhere.
  Global `font: inherit` and `border-color` resets sat outside Tailwind's base
  layer and overrode those utilities. Touch browsers keep form fields
  at 16px so iOS Safari does not zoom in.
- Settings: a flat, row-based dialog without header bands or boxed cards —
  icon navigation, a floating close button, titled groups with hairline
  dividers, an automatic save indicator, and a full-screen layout on phones.
- Conversation history: a one-line header with New and close, a compact search
  field, borderless rows with a hover ⋯ menu that closes on outside click or
  Escape, and a full-width panel on phones.
- Avatar position: drag the avatar on the stage to move it, scroll or pinch to
  resize, arrow keys to nudge, with snapping back to the automatic center and
  size. The panel is a compact popover (a bottom sheet on phones, where the chat
  steps aside while positioning) with slim sliders and ± size steps.
- Automatic avatar framing: standing humanoids are framed from the head to just
  below the shoulders using the model's head hit area (or an estimate centered
  on its top band), while chibi and mascot models are shown whole, large,
  centered, and slightly low. Model bounds are measured after a warm-up update
  and ignore hidden drawables, which previously shrank models such as Mao and
  Wanko; framing also keeps clear of the header and the phone chat drawer.
- First-run setup: a single-column dialog without the empty side panel or
  header and footer bands — a slim step bar, readable 13px text, a short
  outline of the three steps, settings-style rows for language, voice, and the
  service checkup, and a full-screen layout on phones. Each step's title takes
  focus so screen readers announce it.
- Stage backgrounds: five new patterns drawn for Kana — sakura, sparkle,
  clouds, seigaiha waves, and ribbons — replace the previous five. Each
  tile is a single-color mask painted with a theme token, so it stays soft in
  both light and dark themes. A saved choice of a removed pattern falls back to
  the plain stage. The tiles are generated by
  `scripts/generate-stage-patterns.py`.
- The composer's send button uses a plain return-key icon without its own
  background, matching the other composer actions.
- Voice journeys in the Playwright suite select the Settings voice section again;
  their selector also matched the composer's dictation button.
- Voice input (dictation): Brave, which exposes browser speech recognition but
  cannot reach a recognition service, now gets a clear "not supported" message
  instead of a misleading network error; dictation listens in the interface
  language; "no speech" uses the friendly notice.
- Live2D models exported in a moc3 format newer than the Cubism Core supports
  (for example the official Ren sample, moc3 version 6) now fail with a clear
  reason instead of "Unknown error". Imported folders are rejected before they
  are stored, and the avatar stage shows the failure instead of "getting ready".
  Switching avatars while a load is still in flight no longer lets the older
  load hide or mislabel the newer model, and a previous failure is cleared as
  soon as the next load starts.
- First-run setup keeps keyboard focus inside the wizard; Shift+Tab from a
  step's title no longer reaches the workspace behind it.

### Release notes

- **Set a password after upgrading.** Kana no longer ships a default access
  password. Stop Kana, run `npm install -g kana-alya@0.3.0`, then run
  `kana password` (or answer the prompt on the next `kana` / `kana serve`
  start) before signing in again. Existing password hashes keep working.
- **Local voice changed engines.** Qwen3-TTS is replaced by the Irodori-TTS
  v4.1 Anime model on the irodori-c CPU engine. Nothing downloads until you
  press Download in Settings → Voice; voice is off by default on new
  installs. Qwen's `uv` environment and data can be deleted.
- Subtitles follow the language you write in; the subtitle language setting
  is gone. Stored subtitles are unchanged.
- Workspace state moved to per-mount zustand stores and service classes; the
  Hermes model list is cached per session. No user-visible behavior changed.
- Tested against Hermes Agent 0.20.1 (2026.8.13) with Node.js 22.22 on Linux
  x64/glibc. Back up the data root and browser preferences before rolling
  back; do not downgrade Hermes as part of a Kana rollback.

## 0.2.0 — 2026-09-08

### Added

- Qwen3-TTS API v2 with local voice cloning: consented reference audio becomes
  a selectable, deletable voice profile; cloned voices speak every response and
  drive Live2D lip sync like preset speakers.
- Public `kana-alya` CLI package, separated from the private source app. It
  ships the traced production runtime and provides `kana`, `kana serve`,
  `kana setup`, `kana config`, and `kana doctor`.
- A documented VPS path for the npm package as well as source-built standalone
  deployments. Both use one server-side configuration and data root.
- Settings → Hermes control panel: start/restart/stop the official
  `hermes serve` gateway, server-held credentials, live process status, and honest
  unavailability messaging when control is not enabled.
- Visual-novel theme: pastel sky stage with scene art, HUD-style header,
  purple conversation rail, named speech bubble with coral name plate, and a
  floating composer — replacing the white minimal workspace.
- Quick Hermes controls in settings for `/model` and related configuration
  commands, using the live registry rather than copied command lists.
- A provider-neutral spoken-reply queue: responses wait for playback to begin,
  then reveal their subtitle and start Live2D lip sync. Failed or stopped audio
  reveals the response as text and reports the error.

### Changed

- Production preferences always resolve to Hermes, the server-selected TTS
  provider, and Live2D with an honest placeholder when avatar loading fails.
- Live2D switching now uses a load-generation guard so a slow previous model
  can never stack on top of the newly selected one, pauses rendering when the
  stage is hidden or the tab is backgrounded, and caps renderer resolution by
  device capability.
- Real Hermes approval/clarification requests surface directly in dedicated
  dialogs as before; `/approve` and `/deny` resolve them without text parsing.
- TTS provider choice is now exclusively server-side through `tts.provider`.
  Local Qwen and OpenAI-compatible settings can coexist without colliding;
  inactive settings do not affect the active provider.
- The local Qwen runtime waits for a `ready` health state, shares model warmup,
  accepts readable request/startup timeouts, and loads every model component
  from the same pinned Hugging Face snapshot, including offline caches.
- The npm package now publishes under the stable `latest` tag. The source app
  stays private; the public package is assembled from the verified build.

### Fixed

- Stacked double-avatar bug when switching Live2D models quickly.
- `.env.example` no longer enables development mocks by default.
- TTS no longer fails on HTTP origins where `crypto.randomUUID` is unavailable.
- Stop remains available while TTS is synthesizing or playing, cancellation is
  routed to the provider that began the request, and stale audio cannot stop a
  newer reply.
- Password changes revoke prior sessions; login admission, JWT claims, request
  bodies, SSE cleanup, and activity numeric fields are now bounded and
  validated at the server boundary.
- The built-in voice reference survives package-location changes and Qwen
  reports dependency/model-load errors instead of remaining indefinitely in a
  starting state.

### Release notes

- Hermes tokens remain server-side; legacy browser credential fields are
  discarded. Hermes owns the transcript and Kana stores per-turn activity in
  SQLite under the common data root.
- This is the first non-prerelease Kana release. The supported package target
  remains Linux x64 with glibc and Node.js 22.13 or later.
- Current supported behavior, deployment paths, provider configuration, and
  remaining environment limits are recorded in the README and `docs/`.

## Pre-0.2 development history

### Added

- Unmodified Hermes `serve` adapter with durable sessions, live slash catalog,
  protected input, reconnect/backoff, duplicate-terminal protection, and live
  compatibility audit.
- Japanese Kana response envelope with user-selected, historically preserved
  subtitles.
- IndexedDB conversations, search, rename/delete, per-conversation drafts,
  linked/missing/branch markers, and legacy localStorage migration.
- Qwen3-TTS API v1 service/client, lifecycle, cancellation, replay, Web Audio
  playback, amplitude lip sync, target-host p50/p95 acceptance harness, and an
  opt-in ordered sentence-delivery experiment.
- Replaceable Live2D runtime, official Haru/Mao samples with distinct mouth
  bindings, safe renderer reuse during switching, validated folder import,
  hosted/folder model library, previews, and binding files.
- First-run setup, responsive white workspace, safe diagnostics, CSP/security
  headers, local backup/restore, error boundaries, and modal focus management.
- Repeatable quality gate, 42 unit/integration tests, 16 desktop/mobile browser
  journeys, production PWA install/offline audit, isolated real-Hermes
  refresh/restart audit, standalone package assembly, and executable
  dogfood/target-host acceptance gates.
- Validated dogfood journal commands, a structured five-case active Hermes
  restart evidence checker, and one consolidated field-validation handoff.

### Migration notes

- Preference schemas v1–v4 migrate to v5. Hermes tokens move to tab-scoped
  session storage; tokens embedded in legacy WebSocket URLs are stripped and
  moved as well. Existing voice setups retain complete-response delivery.
- Legacy `kana.conversations.v1` history imports idempotently into IndexedDB;
  stored subtitle text/language remains unchanged.
- Backup format `kana.local-backup` v1 excludes Hermes credentials and imported
  Live2D assets. Live2D binding files use a separate version-1 envelope.

### Known limitations

See [supported environment](docs/operator/supported-environment.md) for known
environment limits and platform support.

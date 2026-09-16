# Changelog

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

See [supported environment](docs/SUPPORTED_ENVIRONMENT.md) and the open items in
[PLAN.md](PLAN.md) for known environment limits and future work.
